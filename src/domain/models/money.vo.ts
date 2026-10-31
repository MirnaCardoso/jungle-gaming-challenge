import Decimal from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "../errors/domain.error";

export interface MoneyProps {
  amount: string;   // decimal string, ex.: "25.00"
  currency: string; // ISO-4217, ex.: "BRL"
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!props || typeof props !== "object") {
      throw new InvalidMoneyError("Money props must be an object with amount and currency.");
    }

    const { amount, currency } = props;

    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyError("Money amount must be a non-empty string.");
    }

    const trimmedAmount = amount.trim();

    // Reject scientific notation, NaN, Infinity
    if (/[eE]/.test(trimmedAmount)) {
      throw new InvalidMoneyError("Scientific notation is not allowed for Money.");
    }

    // Must be a valid decimal string: optional '-', digits, optional '.' and at most 2 digits
    const decimalRegex = /^-?\d+(\.\d+)?$/;
    if (!decimalRegex.test(trimmedAmount)) {
      throw new InvalidMoneyError(`Invalid monetary format: "${amount}".`);
    }

    const parts = trimmedAmount.split(".");
    if (parts.length === 2 && parts[1].length > 2) {
      throw new InvalidMoneyError(`Monetary scale cannot exceed 2 decimal places: "${amount}".`);
    }

    if (typeof currency !== "string" || currency.trim().length !== 3) {
      throw new InvalidMoneyError(`Currency must be a 3-letter ISO-4217 code: "${currency}".`);
    }

    const upperCurrency = currency.trim().toUpperCase();

    try {
      const dec = new Decimal(trimmedAmount);
      if (dec.isNaN() || !dec.isFinite()) {
        throw new InvalidMoneyError(`Invalid monetary value: "${amount}".`);
      }
      return new Money(dec, upperCurrency);
    } catch (err: any) {
      if (err instanceof InvalidMoneyError) throw err;
      throw new InvalidMoneyError(`Failed to parse monetary value: "${amount}". Reason: ${err?.message}`);
    }
  }

  static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    if (!other || this.currency !== other.currency) {
      return false;
    }
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  get amount(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
