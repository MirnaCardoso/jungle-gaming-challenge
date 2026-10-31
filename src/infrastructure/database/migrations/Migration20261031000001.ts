import { Migration } from "@mikro-orm/migrations";

export class Migration20261031000001 extends Migration {
  async up(): Promise<void> {
    // 1. Wallets table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY,
        player_id VARCHAR(128) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_amount NUMERIC(18, 2) NOT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wallet_player_currency UNIQUE (player_id, currency),
        CONSTRAINT chk_wallet_balance_non_negative CHECK (balance_amount >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_player_id ON wallets (player_id);
    `);

    // 2. Wager Transactions table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wager_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(128) NOT NULL,
        external_transaction_id VARCHAR(128) NOT NULL,
        idempotency_key VARCHAR(256) NOT NULL UNIQUE,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        player_id VARCHAR(128) NOT NULL,
        round_id VARCHAR(128) NOT NULL,
        game_id VARCHAR(128) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        reference_external_transaction_id VARCHAR(128) NULL,
        reference_transaction_id UUID NULL,
        status VARCHAR(32) NOT NULL,
        failure_code VARCHAR(64) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        CONSTRAINT uq_provider_ext_tx UNIQUE (provider_id, external_transaction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tx_wallet_id ON wager_transactions (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_tx_status ON wager_transactions (status);
    `);

    // 3. Wallet Ledger Entries table (Immutable)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL,
        direction VARCHAR(16) NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_before_amount NUMERIC(18, 2) NOT NULL,
        balance_after_amount NUMERIC(18, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0),
        CONSTRAINT chk_ledger_before_non_negative CHECK (balance_before_amount >= 0),
        CONSTRAINT chk_ledger_after_non_negative CHECK (balance_after_amount >= 0),
        CONSTRAINT chk_ledger_balanced_arithmetic CHECK (
          (direction = 'CREDIT' AND balance_before_amount + amount = balance_after_amount) OR
          (direction = 'DEBIT' AND balance_before_amount - amount = balance_after_amount)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_wallet_id ON wallet_ledger_entries (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_tx_id ON wallet_ledger_entries (transaction_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON wallet_ledger_entries (created_at);

      -- PostgreSQL Trigger to strictly prohibit UPDATE and DELETE on ledger
      CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Ledger entries are strictly immutable. UPDATE or DELETE operations are prohibited.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_ledger_update_delete ON wallet_ledger_entries;
      CREATE TRIGGER trg_prevent_ledger_update_delete
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ledger_mutation();
    `);

    // 4. Inbox Messages table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        consumer_name VARCHAR(128) NOT NULL,
        message_id VARCHAR(128) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    // 5. Outbox Messages table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id VARCHAR(128) NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NULL,
        published_at TIMESTAMPTZ NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_id ON outbox_messages (aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt ON outbox_messages (next_attempt_at) WHERE published_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS trg_prevent_ledger_update_delete ON wallet_ledger_entries;
      DROP FUNCTION IF EXISTS prevent_ledger_mutation();
      DROP TABLE IF EXISTS outbox_messages CASCADE;
      DROP TABLE IF EXISTS inbox_messages CASCADE;
      DROP TABLE IF EXISTS wallet_ledger_entries CASCADE;
      DROP TABLE IF EXISTS wager_transactions CASCADE;
      DROP TABLE IF EXISTS wallets CASCADE;
    `);
  }
}
