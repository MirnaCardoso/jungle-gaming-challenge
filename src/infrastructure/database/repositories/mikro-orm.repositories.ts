import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  InboxRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
  WagerTransactionRepositoryPort,
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../../../application/ports/repository.ports";
import { Wallet } from "../../../domain/models/wallet.aggregate";
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/models/wager-transaction.entity";
import { LedgerDirection, WalletLedgerEntry } from "../../../domain/models/wallet-ledger-entry.entity";
import { InboxMessage } from "../../../domain/models/inbox-message.entity";
import { OutboxMessage } from "../../../domain/models/outbox-message.entity";
import { WalletEntity } from "../entities/wallet.entity";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "../entities/wallet-ledger-entry.entity";
import { InboxMessageEntity } from "../entities/inbox-message.entity";
import { OutboxMessageEntity } from "../entities/outbox-message.entity";

export class MikroOrmWalletRepository implements WalletRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByIdWithLock(id: string): Promise<Wallet | null> {
    // Pessimistic write lock: SELECT ... FOR UPDATE
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { playerId, currency });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async save(wallet: Wallet): Promise<void> {
    let entity = await this.em.findOne(WalletEntity, { id: wallet.id });
    if (!entity) {
      entity = new WalletEntity();
      entity.id = wallet.id;
      entity.playerId = wallet.playerId;
      entity.currency = wallet.currency;
      entity.createdAt = wallet.createdAt;
      this.em.persist(entity);
    }

    entity.balanceAmount = wallet.balance.amount;
    entity.version = wallet.version;
    entity.updatedAt = wallet.updatedAt;
  }

  private toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: {
        amount: entity.balanceAmount,
        currency: entity.currency,
      },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}

export class MikroOrmTransactionRepository implements WagerTransactionRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { idempotencyKey: key });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByProviderAndExternalId(providerId: string, externalId: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId: externalId,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findReversalsByReference(referenceExternalTransactionId: string, kind: string): Promise<WagerTransaction[]> {
    const entities = await this.em.find(WagerTransactionEntity, {
      referenceExternalTransactionId,
      kind,
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatus.PendingReference },
      { limit, orderBy: { createdAt: "ASC" } },
    );
    return entities.map((e) => this.toDomain(e));
  }

  async save(tx: WagerTransaction): Promise<void> {
    let entity = await this.em.findOne(WagerTransactionEntity, { id: tx.id });
    if (!entity) {
      entity = new WagerTransactionEntity();
      entity.id = tx.id;
      entity.providerId = tx.providerId;
      entity.externalTransactionId = tx.externalTransactionId;
      entity.idempotencyKey = tx.idempotencyKey;
      entity.payloadHash = tx.payloadHash;
      entity.walletId = tx.walletId;
      entity.playerId = tx.playerId;
      entity.roundId = tx.roundId;
      entity.gameId = tx.gameId;
      entity.kind = tx.kind;
      entity.amount = tx.money.amount;
      entity.currency = tx.money.currency;
      entity.referenceExternalTransactionId = tx.referenceExternalTransactionId;
      entity.createdAt = tx.createdAt;
      this.em.persist(entity);
    }

    entity.status = tx.status;
    entity.referenceTransactionId = tx.referenceTransactionId;
    entity.failureCode = tx.failureCode;
    entity.processedAt = tx.processedAt;
  }

  private toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: {
        amount: entity.amount,
        currency: entity.currency,
      },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      status: entity.status as WagerTransactionStatus,
      failureCode: entity.failureCode as FailureCode | undefined,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
    });
  }
}

export class MikroOrmLedgerRepository implements WalletLedgerRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = new WalletLedgerEntryEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.amount;
    entity.currency = entry.money.currency;
    entity.balanceBeforeAmount = entry.balanceBefore.amount;
    entity.balanceAfterAmount = entry.balanceAfter.amount;
    entity.createdAt = entry.createdAt;

    this.em.persist(entity);
  }

  async findByWalletId(
    walletId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ entries: WalletLedgerEntry[]; nextCursor?: string }> {
    const limit = options?.limit ?? 50;
    const where: any = { walletId };

    if (options?.cursor) {
      // Opaque base64 cursor encoding the created_at timestamp
      const cursorDate = new Date(Buffer.from(options.cursor, "base64").toString("utf8"));
      where.createdAt = { $lt: cursorDate };
    }

    const entities = await this.em.find(WalletLedgerEntryEntity, where, {
      limit: limit + 1,
      orderBy: { createdAt: "DESC" },
    });

    const hasMore = entities.length > limit;
    const items = hasMore ? entities.slice(0, limit) : entities;
    let nextCursor: string | undefined = undefined;

    if (hasMore) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(last.createdAt.toISOString()).toString("base64");
    }

    return {
      entries: items.map((e) => this.toDomain(e)),
      nextCursor,
    };
  }

  async findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.em.find(
      WalletLedgerEntryEntity,
      { walletId },
      { orderBy: { createdAt: "ASC" } },
    );
    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(e: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: e.id,
      walletId: e.walletId,
      transactionId: e.transactionId,
      direction: e.direction as LedgerDirection,
      money: { amount: e.amount, currency: e.currency },
      balanceBefore: { amount: e.balanceBeforeAmount, currency: e.currency },
      balanceAfter: { amount: e.balanceAfterAmount, currency: e.currency },
      createdAt: e.createdAt,
    });
  }
}

export class MikroOrmInboxRepository implements InboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, { consumerName, messageId });
    if (!entity) return null;
    return InboxMessage.rehydrate({
      consumerName: entity.consumerName,
      messageId: entity.messageId,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  }

  async save(message: InboxMessage): Promise<void> {
    let entity = await this.em.findOne(InboxMessageEntity, {
      consumerName: message.consumerName,
      messageId: message.messageId,
    });
    if (!entity) {
      entity = new InboxMessageEntity();
      entity.consumerName = message.consumerName;
      entity.messageId = message.messageId;
      entity.payloadHash = message.payloadHash;
      entity.receivedAt = message.receivedAt;
      this.em.persist(entity);
    }
    entity.processedAt = message.processedAt;
  }
}

export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async save(message: OutboxMessage): Promise<void> {
    let entity = await this.em.findOne(OutboxMessageEntity, { id: message.id });
    if (!entity) {
      entity = new OutboxMessageEntity();
      entity.id = message.id;
      entity.aggregateId = message.aggregateId;
      entity.eventType = message.eventType;
      entity.payload = message.payload as Record<string, unknown>;
      entity.occurredAt = message.occurredAt;
      this.em.persist(entity);
    }
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt;
    entity.publishedAt = message.publishedAt;
  }

  async findPendingMessages(limit: number, now: Date): Promise<OutboxMessage[]> {
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { limit, orderBy: { occurredAt: "ASC" } },
    );
    return entities.map((e) => this.toDomain(e));
  }

  async findPendingMessagesWithLock(limit: number, now: Date): Promise<OutboxMessage[]> {
    // In PostgreSQL, execute with FOR UPDATE SKIP LOCKED
    const knex = this.em.getKnex();
    const rows = await knex("outbox_messages")
      .whereNull("published_at")
      .andWhere((qb) => {
        qb.whereNull("next_attempt_at").orWhere("next_attempt_at", "<=", now);
      })
      .orderBy("occurred_at", "asc")
      .limit(limit)
      .forUpdate()
      .skipLocked();

    const ids = rows.map((r: any) => r.id);
    if (ids.length === 0) return [];

    const entities = await this.em.find(OutboxMessageEntity, { id: { $in: ids } });
    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(e: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: e.id,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      occurredAt: e.occurredAt,
      attempts: e.attempts,
      nextAttemptAt: e.nextAttemptAt,
      publishedAt: e.publishedAt,
    });
  }
}

export class MikroOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly em: EntityManager) {}

  async executeInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return await this.em.transactional(async () => {
      return await work();
    });
  }
}
