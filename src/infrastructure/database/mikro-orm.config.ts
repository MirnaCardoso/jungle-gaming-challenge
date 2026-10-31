import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletEntity } from "./entities/wallet.entity";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "./entities/wallet-ledger-entry.entity";
import { InboxMessageEntity } from "./entities/inbox-message.entity";
import { OutboxMessageEntity } from "./entities/outbox-message.entity";

export default defineConfig({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  dbName: process.env.DB_NAME || "wagering_db",
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  extensions: [Migrator],
  migrations: {
    path: "./src/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    dropTables: false,
    safe: true,
  },
  debug: process.env.NODE_ENV === "development",
});
