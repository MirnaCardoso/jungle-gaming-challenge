import { v4 as uuidv4 } from "uuid";
import { ProcessWagerTransactionCommand, ProcessWagerTransactionResult } from "../dtos/commands";
import {
  InboxRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
  WagerTransactionRepositoryPort,
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../ports/repository.ports";
import { Money } from "../../domain/models/money.vo";
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/models/wager-transaction.entity";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/models/wallet-ledger-entry.entity";
import {
  CurrencyMismatchError,
  IdempotencyConflictError,
  WalletNotFoundError,
} from "../../domain/errors/domain.error";
import { computePayloadHash } from "../../domain/utils/canonical-json.util";
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from "../../domain/events/domain-events";
import { OutboxMessage } from "../../domain/models/outbox-message.entity";
import { InboxMessage } from "../../domain/models/inbox-message.entity";

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
    private readonly inboxRepo: InboxRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    const correlationId = command.correlationId ?? uuidv4();
    const money = Money.from(command.money);

    // Compute canonical payload hash from domain business fields
    const businessPayload = {
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId ?? null,
    };
    const payloadHash = computePayloadHash(businessPayload);

    return await this.unitOfWork.executeInTransaction(async () => {
      // 1. SQS Inbox deduplication check
      if (command.inboxContext) {
        const existingInbox = await this.inboxRepo.findByConsumerAndMessageId(
          command.inboxContext.consumerName,
          command.inboxContext.messageId,
        );
        if (existingInbox && existingInbox.isProcessed()) {
          // Already successfully processed via this queue message
          const existingTx = await this.transactionRepo.findByIdempotencyKey(command.idempotencyKey);
          if (existingTx) {
            const wallet = await this.walletRepo.findById(command.walletId);
            return {
              transactionId: existingTx.id,
              status: existingTx.status,
              balance: wallet ? wallet.balance.toJSON() : money.toJSON(),
              idempotentReplay: true,
              failureCode: existingTx.failureCode,
            };
          }
        }
      }

      // 2. Check Idempotency by key
      const existingTx = await this.transactionRepo.findByIdempotencyKey(command.idempotencyKey);
      if (existingTx) {
        if (!existingTx.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }

        const wallet = await this.walletRepo.findById(command.walletId);
        return {
          transactionId: existingTx.id,
          status: existingTx.status,
          balance: wallet ? wallet.balance.toJSON() : money.toJSON(),
          idempotentReplay: true,
          failureCode: existingTx.failureCode,
        };
      }

      // 3. Acquire Pessimistic Write Lock on the Wallet
      const wallet = await this.walletRepo.findByIdWithLock(command.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(command.walletId);
      }

      // Double-check idempotency once inside the lock
      const lockedExistingTx = await this.transactionRepo.findByIdempotencyKey(command.idempotencyKey);
      if (lockedExistingTx) {
        if (!lockedExistingTx.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }
        return {
          transactionId: lockedExistingTx.id,
          status: lockedExistingTx.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: true,
          failureCode: lockedExistingTx.failureCode,
        };
      }

      if (wallet.currency !== money.currency) {
        throw new CurrencyMismatchError(wallet.currency, money.currency);
      }

      // 4. Create new transaction in PENDING status
      const txId = uuidv4();
      const transaction = WagerTransaction.create({
        id: txId,
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
      });

      // 5. Handle reference requirements (REFUND / ROLLBACK)
      let referencedTx: WagerTransaction | null = null;
      if (transaction.requiresReference()) {
        const ref = await this.transactionRepo.findByProviderAndExternalId(
          command.providerId,
          command.referenceExternalTransactionId!,
        );

        if (!ref) {
          // Reference not arrived yet -> transition to PENDING_REFERENCE (Out of order)
          transaction.markPendingReference();
          await this.transactionRepo.save(transaction);

          const pendingEvent = WagerTransactionPendingReference.from(transaction, { correlationId });
          await this.outboxRepo.save(OutboxMessage.enqueue(pendingEvent));

          await this.handleInboxPersistence(command.inboxContext, payloadHash);

          return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }

        // Validate reference invariants
        if (
          ref.providerId !== transaction.providerId ||
          ref.playerId !== transaction.playerId ||
          ref.walletId !== transaction.walletId ||
          ref.money.currency !== transaction.money.currency ||
          ref.roundId !== transaction.roundId
        ) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.REFERENCE_MISMATCH,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        if (ref.status !== WagerTransactionStatus.Processed) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.INVALID_REFERENCE_KIND,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        // Validate allowed reference kind
        if (transaction.kind === WagerTransactionKind.Refund && ref.kind !== WagerTransactionKind.Bet) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.INVALID_REFERENCE_KIND,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        if (
          transaction.kind === WagerTransactionKind.Rollback &&
          ref.kind !== WagerTransactionKind.Bet &&
          ref.kind !== WagerTransactionKind.Win &&
          ref.kind !== WagerTransactionKind.Refund
        ) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.INVALID_REFERENCE_KIND,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        // Check if already reversed by same operation
        const reversals = await this.transactionRepo.findReversalsByReference(
          ref.externalTransactionId,
          transaction.kind,
        );
        const processedReversals = reversals.filter(
          (r) => r.status === WagerTransactionStatus.Processed && r.id !== transaction.id,
        );
        if (processedReversals.length > 0) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.REFERENCE_ALREADY_REVERSED,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        // Check exact amount match
        if (!ref.money.equals(transaction.money)) {
          return await this.rejectTransaction(
            transaction,
            FailureCode.REFERENCE_AMOUNT_MISMATCH,
            wallet,
            correlationId,
            command.inboxContext,
            payloadHash,
          );
        }

        referencedTx = ref;
      }

      // 6. Execute Business Operation
      switch (transaction.kind) {
        case WagerTransactionKind.Bet: {
          if (wallet.balance.isLessThan(money)) {
            return await this.rejectTransaction(
              transaction,
              FailureCode.INSUFFICIENT_FUNDS,
              wallet,
              correlationId,
              command.inboxContext,
              payloadHash,
            );
          }

          const { balanceBefore, balanceAfter } = wallet.debit(money);
          await this.walletRepo.save(wallet);

          const ledgerEntry = WalletLedgerEntry.create({
            id: uuidv4(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: LedgerDirection.Debit,
            money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          transaction.markProcessed(undefined, new Date());
          await this.transactionRepo.save(transaction);

          await this.outboxRepo.save(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
            ),
          );
          await this.outboxRepo.save(
            OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, ledgerEntry, { correlationId })),
          );
          break;
        }

        case WagerTransactionKind.Win: {
          const { balanceBefore, balanceAfter } = wallet.credit(money);
          await this.walletRepo.save(wallet);

          const ledgerEntry = WalletLedgerEntry.create({
            id: uuidv4(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          transaction.markProcessed(undefined, new Date());
          await this.transactionRepo.save(transaction);

          await this.outboxRepo.save(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
            ),
          );
          await this.outboxRepo.save(
            OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, ledgerEntry, { correlationId })),
          );
          break;
        }

        case WagerTransactionKind.Loss: {
          // LOSS does not affect balance, produces no ledger entry
          transaction.markProcessed(undefined, new Date());
          await this.transactionRepo.save(transaction);

          await this.outboxRepo.save(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
            ),
          );
          break;
        }

        case WagerTransactionKind.Refund: {
          // REFUND credits the wallet
          const { balanceBefore, balanceAfter } = wallet.credit(money);
          await this.walletRepo.save(wallet);

          const ledgerEntry = WalletLedgerEntry.create({
            id: uuidv4(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          transaction.markProcessed(referencedTx!.id, new Date());
          await this.transactionRepo.save(transaction);

          await this.outboxRepo.save(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
            ),
          );
          await this.outboxRepo.save(
            OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, ledgerEntry, { correlationId })),
          );
          break;
        }

        case WagerTransactionKind.Rollback: {
          const targetDirection = transaction.ledgerDirectionFor(referencedTx!);

          if (targetDirection === LedgerDirection.Debit) {
            // Reversing a credit requires a debit
            if (wallet.balance.isLessThan(money)) {
              return await this.rejectTransaction(
                transaction,
                FailureCode.REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE,
                wallet,
                correlationId,
                command.inboxContext,
                payloadHash,
              );
            }
            const { balanceBefore, balanceAfter } = wallet.debit(money);
            await this.walletRepo.save(wallet);

            const ledgerEntry = WalletLedgerEntry.create({
              id: uuidv4(),
              walletId: wallet.id,
              transactionId: transaction.id,
              direction: LedgerDirection.Debit,
              money,
              balanceBefore,
              balanceAfter,
            });
            await this.ledgerRepo.save(ledgerEntry);

            transaction.markProcessed(referencedTx!.id, new Date());
            await this.transactionRepo.save(transaction);

            await this.outboxRepo.save(
              OutboxMessage.enqueue(
                WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
              ),
            );
            await this.outboxRepo.save(
              OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, ledgerEntry, { correlationId })),
            );
          } else {
            // Reversing a debit requires a credit
            const { balanceBefore, balanceAfter } = wallet.credit(money);
            await this.walletRepo.save(wallet);

            const ledgerEntry = WalletLedgerEntry.create({
              id: uuidv4(),
              walletId: wallet.id,
              transactionId: transaction.id,
              direction: LedgerDirection.Credit,
              money,
              balanceBefore,
              balanceAfter,
            });
            await this.ledgerRepo.save(ledgerEntry);

            transaction.markProcessed(referencedTx!.id, new Date());
            await this.transactionRepo.save(transaction);

            await this.outboxRepo.save(
              OutboxMessage.enqueue(
                WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), { correlationId }),
              ),
            );
            await this.outboxRepo.save(
              OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, ledgerEntry, { correlationId })),
            );
          }
          break;
        }

        default:
          throw new Error(`Unsupported transaction kind: ${transaction.kind}`);
      }

      await this.handleInboxPersistence(command.inboxContext, payloadHash);

      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }

  private async rejectTransaction(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    wallet: any,
    correlationId: string,
    inboxContext?: { consumerName: string; messageId: string },
    payloadHash?: string,
  ): Promise<ProcessWagerTransactionResult> {
    transaction.reject(failureCode);
    await this.transactionRepo.save(transaction);

    const rejectedEvent = WagerTransactionRejected.from(transaction, failureCode, { correlationId });
    await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));

    await this.handleInboxPersistence(inboxContext, payloadHash ?? transaction.payloadHash);

    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
      failureCode,
    };
  }

  private async handleInboxPersistence(
    inboxContext: { consumerName: string; messageId: string } | undefined,
    payloadHash: string,
  ): Promise<void> {
    if (!inboxContext) return;

    let inbox = await this.inboxRepo.findByConsumerAndMessageId(
      inboxContext.consumerName,
      inboxContext.messageId,
    );

    if (!inbox) {
      inbox = InboxMessage.receive({
        consumerName: inboxContext.consumerName,
        messageId: inboxContext.messageId,
        payloadHash,
      });
    }

    inbox.markProcessed(new Date());
    await this.inboxRepo.save(inbox);
  }
}
