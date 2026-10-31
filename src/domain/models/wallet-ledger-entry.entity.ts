import { Money, MoneyProps } from "./money.vo";
import { InvalidMoneyError } from "../errors/domain.error";

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.id || props.id.trim() === "") {
      throw new Error("Ledger entry ID is required.");
    }
    if (!props.walletId || props.walletId.trim() === "") {
      throw new Error("Wallet ID is required.");
    }
    if (!props.transactionId || props.transactionId.trim() === "") {
      throw new Error("Transaction ID is required.");
    }
    if (!props.money || props.money.isNegative() || props.money.isZero()) {
      throw new InvalidMoneyError("Ledger entry amount must be strictly positive.");
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new InvalidMoneyError(
        `Ledger entry arithmetic unbalanced: balanceBefore (${props.balanceBefore.amount}) ${
          props.direction === LedgerDirection.Credit ? "+" : "-"
        } money (${props.money.amount}) does not equal balanceAfter (${props.balanceAfter.amount}).`,
      );
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      Money.from(state.money),
      Money.from(state.balanceBefore),
      Money.from(state.balanceAfter),
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      const expected = this.balanceBefore.add(this.money);
      return expected.equals(this.balanceAfter);
    } else {
      const expected = this.balanceBefore.subtract(this.money);
      return expected.equals(this.balanceAfter);
    }
  }

  toState(): LedgerEntryState {
    return {
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction,
      money: this.money.toJSON(),
      balanceBefore: this.balanceBefore.toJSON(),
      balanceAfter: this.balanceAfter.toJSON(),
      createdAt: this.createdAt,
    };
  }
}
