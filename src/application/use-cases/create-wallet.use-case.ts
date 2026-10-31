import { v4 as uuidv4 } from "uuid";
import { CreateWalletCommand, CreateWalletResult } from "../dtos/commands";
import {
  InboxRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
  WagerTransactionRepositoryPort,
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../ports/repository.ports";
import { Money } from "../../domain/models/money.vo";
import { Wallet } from "../../domain/models/wallet.aggregate";
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/models/wager-transaction.entity";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/models/wallet-ledger-entry.entity";
import { WalletAlreadyExistsError } from "../../domain/errors/domain.error";
import { computePayloadHash } from "../../domain/utils/canonical-json.util";
import { WalletBalanceChanged } from "../../domain/events/domain-events";
import { OutboxMessage } from "../../domain/models/outbox-message.entity";

export class CreateWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const initialMoney = Money.from(command.initialBalance);

    return await this.unitOfWork.executeInTransaction(async () => {
      // 1. Check if wallet already exists for (playerId, currency)
      const existing = await this.walletRepo.findByPlayerIdAndCurrency(
        command.playerId,
        initialMoney.currency,
      );
      if (existing) {
        throw new WalletAlreadyExistsError(command.playerId, initialMoney.currency);
      }

      // 2. Open wallet
      const walletId = uuidv4();
      const wallet = Wallet.open({
        id: walletId,
        playerId: command.playerId,
        initialBalance: initialMoney,
      });

      await this.walletRepo.save(wallet);

      // 3. If initial balance > 0, record OPENING transaction & ledger entry
      if (initialMoney.isPositive()) {
        const txId = uuidv4();
        const openingPayload = {
          type: "OPENING",
          walletId,
          playerId: command.playerId,
          amount: initialMoney.amount,
          currency: initialMoney.currency,
        };
        const payloadHash = computePayloadHash(openingPayload);

        const openingTx = WagerTransaction.create({
          id: txId,
          providerId: "INTERNAL",
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `internal:opening:${walletId}`,
          payloadHash,
          walletId,
          playerId: command.playerId,
          roundId: "opening-round",
          gameId: "system",
          kind: WagerTransactionKind.Opening,
          money: initialMoney,
        });

        openingTx.markProcessed(undefined, new Date());
        await this.transactionRepo.save(openingTx);

        // Ledger entry: balanceBefore was 0.00, balanceAfter is initialMoney
        const zeroMoney = Money.zero(initialMoney.currency);
        const ledgerEntry = WalletLedgerEntry.create({
          id: uuidv4(),
          walletId,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: zeroMoney,
          balanceAfter: initialMoney,
        });

        await this.ledgerRepo.save(ledgerEntry);

        // Enqueue Outbox event
        const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
          correlationId: `opening-${walletId}`,
        });
        await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
