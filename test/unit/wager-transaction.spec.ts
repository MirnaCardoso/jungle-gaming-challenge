import { describe, expect, it } from "bun:test";
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction.entity";
import { Money } from "../../src/domain/models/money.vo";
import { LedgerDirection } from "../../src/domain/models/wallet-ledger-entry.entity";
import { InvalidTransactionStateError } from "../../src/domain/errors/domain.error";

describe("WagerTransaction Entity", () => {
  const defaultMoney = Money.from({ amount: "25.00", currency: "BRL" });

  it("creates a BET transaction born in PENDING", () => {
    const tx = WagerTransaction.create({
      id: "tx-1",
      providerId: "provider-a",
      externalTransactionId: "ext-1",
      idempotencyKey: "provider-a:ext-1",
      payloadHash: "hash-123",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: defaultMoney,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
    expect(tx.requiresReference()).toBe(false);
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it("requires reference for REFUND and ROLLBACK", () => {
    expect(() =>
      WagerTransaction.create({
        id: "tx-2",
        providerId: "provider-a",
        externalTransactionId: "ext-2",
        idempotencyKey: "provider-a:ext-2",
        payloadHash: "hash-456",
        walletId: "w-1",
        playerId: "p-1",
        roundId: "r-1",
        gameId: "g-1",
        kind: WagerTransactionKind.Refund,
        money: defaultMoney,
      })
    ).toThrow();
  });

  it("transitions to PROCESSED and prevents further transitions", () => {
    const tx = WagerTransaction.create({
      id: "tx-3",
      providerId: "provider-a",
      externalTransactionId: "ext-3",
      idempotencyKey: "provider-a:ext-3",
      payloadHash: "hash-789",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Win,
      money: defaultMoney,
    });

    const now = new Date();
    tx.markProcessed(undefined, now);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);

    expect(() => tx.reject(FailureCode.INSUFFICIENT_FUNDS)).toThrow(InvalidTransactionStateError);
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(InvalidTransactionStateError);
  });

  it("identifies that LOSS does not affect balance", () => {
    const tx = WagerTransaction.create({
      id: "tx-4",
      providerId: "provider-a",
      externalTransactionId: "ext-4",
      idempotencyKey: "provider-a:ext-4",
      payloadHash: "hash-loss",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Loss,
      money: defaultMoney,
    });

    expect(tx.affectsBalance()).toBe(false);
    expect(() => tx.ledgerDirectionFor()).toThrow();
  });

  it("calculates ROLLBACK ledger direction as inverse of reference", () => {
    const betTx = WagerTransaction.create({
      id: "tx-bet",
      providerId: "provider-a",
      externalTransactionId: "ext-bet",
      idempotencyKey: "provider-a:ext-bet",
      payloadHash: "hash-bet",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: defaultMoney,
    });

    const rollbackTx = WagerTransaction.create({
      id: "tx-rollback",
      providerId: "provider-a",
      externalTransactionId: "ext-rollback",
      idempotencyKey: "provider-a:ext-rollback",
      payloadHash: "hash-rb",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Rollback,
      money: defaultMoney,
      referenceExternalTransactionId: "ext-bet",
    });

    expect(rollbackTx.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);
  });
});
