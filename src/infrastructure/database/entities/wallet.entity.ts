import { Entity, PrimaryKey, Property, Unique, Index, Check } from "@mikro-orm/core";

@Entity({ tableName: "wallets" })
@Unique({ properties: ["playerId", "currency"], name: "uq_wallet_player_currency" })
@Check({ expression: "balance_amount >= 0", name: "chk_wallet_balance_non_negative" })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 128 })
  @Index({ name: "idx_wallet_player_id" })
  playerId!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 18, scale: 2, name: "balance_amount" })
  balanceAmount!: string;

  @Property({ type: "integer", default: 1 })
  version!: number;

  @Property({ type: "timestamptz", name: "created_at" })
  createdAt: Date = new Date();

  @Property({ type: "timestamptz", name: "updated_at", onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
