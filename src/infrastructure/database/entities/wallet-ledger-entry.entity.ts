import { Entity, PrimaryKey, Property, Index, Check } from "@mikro-orm/core";

@Entity({ tableName: "wallet_ledger_entries" })
@Check({ expression: "amount > 0", name: "chk_ledger_amount_positive" })
@Check({ expression: "balance_before_amount >= 0", name: "chk_ledger_before_non_negative" })
@Check({ expression: "balance_after_amount >= 0", name: "chk_ledger_after_non_negative" })
@Check({
  expression:
    "(direction = 'CREDIT' AND balance_before_amount + amount = balance_after_amount) OR (direction = 'DEBIT' AND balance_before_amount - amount = balance_after_amount)",
  name: "chk_ledger_balanced_arithmetic",
})
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid", name: "wallet_id" })
  @Index({ name: "idx_ledger_wallet_id" })
  walletId!: string;

  @Property({ type: "uuid", name: "transaction_id" })
  @Index({ name: "idx_ledger_tx_id" })
  transactionId!: string;

  @Property({ type: "varchar", length: 16 })
  direction!: string;

  @Property({ type: "decimal", precision: 18, scale: 2, name: "amount" })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 18, scale: 2, name: "balance_before_amount" })
  balanceBeforeAmount!: string;

  @Property({ type: "decimal", precision: 18, scale: 2, name: "balance_after_amount" })
  balanceAfterAmount!: string;

  @Property({ type: "timestamptz", name: "created_at" })
  @Index({ name: "idx_ledger_created_at" })
  createdAt: Date = new Date();
}
