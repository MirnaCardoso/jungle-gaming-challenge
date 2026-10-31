import { describe, expect, it } from "bun:test";
import { Money } from "../../src/domain/models/money.vo";
import { CurrencyMismatchError, InvalidMoneyError } from "../../src/domain/errors/domain.error";

describe("Money Value Object", () => {
  it("creates valid money with scale 2", () => {
    const m = Money.from({ amount: "25.00", currency: "BRL" });
    expect(m.amount).toBe("25.00");
    expect(m.currency).toBe("BRL");
    expect(m.toString()).toBe("25.00 BRL");
  });

  it("creates zero money", () => {
    const zero = Money.zero("BRL");
    expect(zero.amount).toBe("0.00");
    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
  });

  it("rejects scientific notation", () => {
    expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "2.5E2", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  it("rejects scale with more than 2 decimal places", () => {
    expect(() => Money.from({ amount: "25.005", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "10.1234", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  it("rejects NaN and non-numeric inputs", () => {
    expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  it("performs precise addition without floating point inaccuracies", () => {
    const a = Money.from({ amount: "0.10", currency: "BRL" });
    const b = Money.from({ amount: "0.20", currency: "BRL" });
    const sum = a.add(b);
    expect(sum.amount).toBe("0.30");
  });

  it("performs precise subtraction", () => {
    const a = Money.from({ amount: "100.00", currency: "BRL" });
    const b = Money.from({ amount: "25.50", currency: "BRL" });
    const result = a.subtract(b);
    expect(result.amount).toBe("74.50");
  });

  it("throws CurrencyMismatchError when adding or subtracting different currencies", () => {
    const brl = Money.from({ amount: "10.00", currency: "BRL" });
    const usd = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it("checks equality correctly", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });
    const c = Money.from({ amount: "10.00", currency: "USD" });
    const d = Money.from({ amount: "10.01", currency: "BRL" });

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(d)).toBe(false);
  });
});
