import {
  OutboxRepositoryPort,
  UnitOfWorkPort,
  WagerTransactionRepositoryPort,
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../ports/repository.ports";
import { FailureCode, WagerTransactionStatus } from "../../domain/models/wager-transaction.entity";
import { ProcessWagerTransactionUseCase } from "./process-wager-transaction.use-case";
import { WagerTransactionRejected } from "../../domain/events/domain-events";
import { OutboxMessage } from "../../domain/models/outbox-message.entity";

export class ReprocessPendingReferencesUseCase {
  private static readonly MAX_TTL_MS = 1000 * 60 * 5; // 5 minutes TTL

  constructor(
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(limit: number = 20): Promise<number> {
    const pendingList = await this.transactionRepo.findPendingReferences(limit);
    let processedCount = 0;

    const now = new Date();

    for (const tx of pendingList) {
      if (tx.status !== WagerTransactionStatus.PendingReference) continue;

      const ageMs = now.getTime() - tx.createdAt.getTime();

      // Check if reference has arrived
      if (tx.referenceExternalTransactionId) {
        const ref = await this.transactionRepo.findByProviderAndExternalId(
          tx.providerId,
          tx.referenceExternalTransactionId,
        );

        if (ref && ref.status === WagerTransactionStatus.Processed) {
          // Reference is now available! Re-execute process transaction
          await this.processWagerUseCase.execute({
            idempotencyKey: tx.idempotencyKey,
            providerId: tx.providerId,
            externalTransactionId: tx.externalTransactionId,
            playerId: tx.playerId,
            walletId: tx.walletId,
            roundId: tx.roundId,
            gameId: tx.gameId,
            kind: tx.kind,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            correlationId: `reprocess-${tx.id}`,
          });
          processedCount++;
          continue;
        }
      }

      // If TTL expired and reference still not found
      if (ageMs > ReprocessPendingReferencesUseCase.MAX_TTL_MS) {
        await this.unitOfWork.executeInTransaction(async () => {
          tx.reject(FailureCode.REFERENCE_PENDING_EXPIRED);
          await this.transactionRepo.save(tx);

          const event = WagerTransactionRejected.from(tx, FailureCode.REFERENCE_PENDING_EXPIRED, {
            correlationId: `expired-${tx.id}`,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
        });
        processedCount++;
      }
    }

    return processedCount;
  }
}
