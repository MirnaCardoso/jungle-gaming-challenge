import { Money, MoneyProps } from "./money.vo";
import { CurrencyMismatchError, InsufficientFundsError, InvalidMoneyError } from "../errors/domain.error";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    if (!props.id || props.id.trim() === "") {
      throw new Error("Wallet ID is required.");
    }
    if (!props.playerId || props.playerId.trim() === "") {
      throw new Error("Player ID is required.");
    }
    if (!props.initialBalance) {
      throw new InvalidMoneyError("Initial balance is required.");
    }
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError("Initial balance cannot be negative.");
    }

    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1, // Initial version starts at 1
      now,
      now,
    );
  }

  /** Reconstrução a partir da persistência — não revalida transições. */
  static rehydrate(state: WalletState): Wallet {
    const money = Money.from(state.balance);
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      money,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(amount: Money): { balanceBefore: Money; balanceAfter: Money } {
    this.assertSameCurrency(amount);
    if (amount.isNegative()) {
      throw new InvalidMoneyError("Debit amount cannot be negative.");
    }

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientFundsError(this.id, this._balance.amount, amount.amount);
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(amount);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return { balanceBefore, balanceAfter };
  }

  credit(amount: Money): { balanceBefore: Money; balanceAfter: Money } {
    this.assertSameCurrency(amount);
    if (amount.isNegative()) {
      throw new InvalidMoneyError("Credit amount cannot be negative.");
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(amount);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return { balanceBefore, balanceAfter };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }

  toState(): WalletState {
    return {
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: this._balance.toJSON(),
      version: this._version,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
