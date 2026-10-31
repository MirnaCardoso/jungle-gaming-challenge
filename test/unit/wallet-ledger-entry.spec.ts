import { describe, expect, it } from "bun:test";
import { LedgerDirection, WalletLedgerEntry } from "../../src/domain/models/wallet-ledger-entry.entity";
import { Money } from "../../src/domain/models/money.vo";
import { InvalidMoneyError } from "../../src/domain/errors/domain.error";

describe("WalletLedgerEntry Entity", () => {
  it("creates a balanced CREDIT entry", () => {
    const entry = WalletLedgerEntry.create({
      id: "le-1",
      walletId: "w-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "150.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it("creates a balanced DEBIT entry", () => {
    const entry = WalletLedgerEntry.create({
      id: "le-2",
      walletId: "w-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "30.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "70.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it("throws InvalidMoneyError if arithmetic is unbalanced", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "le-3",
        walletId: "w-1",
        transactionId: "tx-3",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "200.00", currency: "BRL" }), // Wrong! Should be 150
      })
    ).toThrow(InvalidMoneyError);
  });
});
