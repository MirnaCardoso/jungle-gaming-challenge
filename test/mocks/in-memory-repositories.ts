import {
  InboxRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
  WagerTransactionRepositoryPort,
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../../src/application/ports/repository.ports";
import { Wallet } from "../../src/domain/models/wallet.aggregate";
import { WagerTransaction, WagerTransactionStatus } from "../../src/domain/models/wager-transaction.entity";
import { WalletLedgerEntry } from "../../src/domain/models/wallet-ledger-entry.entity";
import { InboxMessage } from "../../src/domain/models/inbox-message.entity";
import { OutboxMessage } from "../../src/domain/models/outbox-message.entity";

export class InMemoryWalletRepository implements WalletRepositoryPort {
  public wallets = new Map<string, Wallet>();

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Wallet | null> {
    return this.findById(id);
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const w of this.wallets.values()) {
      if (w.playerId === playerId && w.currency === currency) {
        return w;
      }
    }
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
  }
}

export class InMemoryTransactionRepository implements WagerTransactionRepositoryPort {
  public transactions = new Map<string, WagerTransaction>();

  async findById(id: string): Promise<WagerTransaction | null> {
    return this.transactions.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.idempotencyKey === key) return tx;
    }
    return null;
  }

  async findByProviderAndExternalId(providerId: string, externalId: string): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.providerId === providerId && tx.externalTransactionId === externalId) {
        return tx;
      }
    }
    return null;
  }

  async findReversalsByReference(referenceExternalTransactionId: string, kind: string): Promise<WagerTransaction[]> {
    const res: WagerTransaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.referenceExternalTransactionId === referenceExternalTransactionId && tx.kind === kind) {
        res.push(tx);
      }
    }
    return res;
  }

  async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const res: WagerTransaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.status === WagerTransactionStatus.PendingReference) {
        res.push(tx);
        if (res.length >= limit) break;
      }
    }
    return res;
  }

  async save(transaction: WagerTransaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }
}

export class InMemoryLedgerRepository implements WalletLedgerRepositoryPort {
  public entries: WalletLedgerEntry[] = [];

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByWalletId(walletId: string, options?: { limit?: number; cursor?: string }): Promise<{ entries: WalletLedgerEntry[]; nextCursor?: string }> {
    const list = this.entries.filter((e) => e.walletId === walletId);
    return { entries: list };
  }

  async findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    return this.entries.filter((e) => e.walletId === walletId);
  }
}

export class InMemoryInboxRepository implements InboxRepositoryPort {
  public messages = new Map<string, InboxMessage>();

  async findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    return this.messages.get(`${consumerName}:${messageId}`) ?? null;
  }

  async save(message: InboxMessage): Promise<void> {
    this.messages.set(`${message.consumerName}:${message.messageId}`, message);
  }
}

export class InMemoryOutboxRepository implements OutboxRepositoryPort {
  public messages: OutboxMessage[] = [];

  async save(message: OutboxMessage): Promise<void> {
    const idx = this.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      this.messages[idx] = message;
    } else {
      this.messages.push(message);
    }
  }

  async findPendingMessages(limit: number, now: Date): Promise<OutboxMessage[]> {
    return this.messages.filter((m) => m.isDue(now)).slice(0, limit);
  }

  async findPendingMessagesWithLock(limit: number, now: Date): Promise<OutboxMessage[]> {
    return this.findPendingMessages(limit, now);
  }
}

export class InMemoryUnitOfWork implements UnitOfWorkPort {
  async executeInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return await work();
  }
}
