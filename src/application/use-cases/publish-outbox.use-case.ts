import { OutboxRepositoryPort, UnitOfWorkPort } from "../ports/repository.ports";

export interface MessageBrokerPort {
  publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export class PublishOutboxUseCase {
  constructor(
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly broker: MessageBrokerPort,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(batchSize: number = 20): Promise<number> {
    const now = new Date();

    // Use pessimistic lock / SKIP LOCKED to support concurrent outbox workers safely
    const messages = await this.outboxRepo.findPendingMessagesWithLock(batchSize, now);
    let publishedCount = 0;

    for (const msg of messages) {
      try {
        await this.broker.publish(msg.eventType, msg.payload as Record<string, unknown>);

        await this.unitOfWork.executeInTransaction(async () => {
          msg.markPublished(new Date());
          await this.outboxRepo.save(msg);
        });

        publishedCount++;
      } catch (err) {
        await this.unitOfWork.executeInTransaction(async () => {
          msg.scheduleRetry(new Date());
          await this.outboxRepo.save(msg);
        });
      }
    }

    return publishedCount;
  }
}
