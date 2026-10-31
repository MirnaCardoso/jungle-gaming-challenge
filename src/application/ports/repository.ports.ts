import { Wallet } from "../../domain/models/wallet.aggregate";
import { WagerTransaction } from "../../domain/models/wager-transaction.entity";
import { WalletLedgerEntry } from "../../domain/models/wallet-ledger-entry.entity";
import { InboxMessage } from "../../domain/models/inbox-message.entity";
import { OutboxMessage } from "../../domain/models/outbox-message.entity";

export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;
  findByIdWithLock(id: string): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

export interface WagerTransactionRepositoryPort {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(providerId: string, externalId: string): Promise<WagerTransaction | null>;
  findReversalsByReference(referenceExternalTransactionId: string, kind: string): Promise<WagerTransaction[]>;
  findPendingReferences(limit: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction): Promise<void>;
}

export interface WalletLedgerRepositoryPort {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(walletId: string, options?: { limit?: number; cursor?: string }): Promise<{ entries: WalletLedgerEntry[]; nextCursor?: string }>;
  findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
}

export interface InboxRepositoryPort {
  findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<void>;
}

export interface OutboxRepositoryPort {
  save(message: OutboxMessage): Promise<void>;
  findPendingMessages(limit: number, now: Date): Promise<OutboxMessage[]>;
  findPendingMessagesWithLock(limit: number, now: Date): Promise<OutboxMessage[]>;
}

export interface UnitOfWorkPort {
  executeInTransaction<T>(work: () => Promise<T>): Promise<T>;
}
