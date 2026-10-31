import { describe, expect, it } from "bun:test";
import { Wallet } from "../../src/domain/models/wallet.aggregate";
import { Money } from "../../src/domain/models/money.vo";
import { CurrencyMismatchError, InsufficientFundsError, InvalidMoneyError } from "../../src/domain/errors/domain.error";

describe("Wallet Aggregate Root", () => {
  it("opens a wallet with positive initial balance", () => {
    const initial = Money.from({ amount: "100.00", currency: "BRL" });
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: initial,
    });

    expect(wallet.id).toBe("w-1");
    expect(wallet.playerId).toBe("p-1");
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.amount).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  it("debits balance and increments version", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const debitResult = wallet.debit(Money.from({ amount: "40.00", currency: "BRL" }));
    expect(debitResult.balanceBefore.amount).toBe("100.00");
    expect(debitResult.balanceAfter.amount).toBe("60.00");
    expect(wallet.balance.amount).toBe("60.00");
    expect(wallet.version).toBe(2);
  });

  it("throws InsufficientFundsError when debit exceeds balance", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    expect(() => wallet.debit(Money.from({ amount: "80.00", currency: "BRL" }))).toThrow(InsufficientFundsError);
    expect(wallet.balance.amount).toBe("50.00");
    expect(wallet.version).toBe(1);
  });

  it("credits balance and increments version", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const creditResult = wallet.credit(Money.from({ amount: "25.00", currency: "BRL" }));
    expect(creditResult.balanceBefore.amount).toBe("50.00");
    expect(creditResult.balanceAfter.amount).toBe("75.00");
    expect(wallet.balance.amount).toBe("75.00");
    expect(wallet.version).toBe(2);
  });

  it("throws CurrencyMismatchError if debiting or crediting different currency", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const usd = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => wallet.debit(usd)).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(usd)).toThrow(CurrencyMismatchError);
  });

  it("rejects negative initial balance", () => {
    const neg = Money.from({ amount: "-10.00", currency: "BRL" });
    expect(() => Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: neg })).toThrow(InvalidMoneyError);
  });
});
