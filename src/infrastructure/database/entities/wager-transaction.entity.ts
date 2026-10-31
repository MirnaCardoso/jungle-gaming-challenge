import { Entity, PrimaryKey, Property, Unique, Index } from "@mikro-orm/core";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["providerId", "externalTransactionId"], name: "uq_provider_ext_tx" })
@Unique({ properties: ["idempotencyKey"], name: "uq_idempotency_key" })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 128, name: "provider_id" })
  providerId!: string;

  @Property({ type: "varchar", length: 128, name: "external_transaction_id" })
  externalTransactionId!: string;

  @Property({ type: "varchar", length: 256, name: "idempotency_key" })
  idempotencyKey!: string;

  @Property({ type: "varchar", length: 64, name: "payload_hash" })
  payloadHash!: string;

  @Property({ type: "uuid", name: "wallet_id" })
  @Index({ name: "idx_tx_wallet_id" })
  walletId!: string;

  @Property({ type: "varchar", length: 128, name: "player_id" })
  playerId!: string;

  @Property({ type: "varchar", length: 128, name: "round_id" })
  roundId!: string;

  @Property({ type: "varchar", length: 128, name: "game_id" })
  gameId!: string;

  @Property({ type: "varchar", length: 32 })
  kind!: string;

  @Property({ type: "decimal", precision: 18, scale: 2, name: "amount" })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "varchar", length: 128, nullable: true, name: "reference_external_transaction_id" })
  referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true, name: "reference_transaction_id" })
  referenceTransactionId?: string;

  @Property({ type: "varchar", length: 32 })
  @Index({ name: "idx_tx_status" })
  status!: string;

  @Property({ type: "varchar", length: 64, nullable: true, name: "failure_code" })
  failureCode?: string;

  @Property({ type: "timestamptz", name: "created_at" })
  createdAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true, name: "processed_at" })
  processedAt?: Date;
}
