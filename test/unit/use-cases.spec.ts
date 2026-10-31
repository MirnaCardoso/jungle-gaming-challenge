import { beforeEach, describe, expect, it } from "bun:test";
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryTransactionRepository,
  InMemoryUnitOfWork,
  InMemoryWalletRepository,
} from "../mocks/in-memory-repositories";
import { CreateWalletUseCase } from "../../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "../../src/application/use-cases/reconcile-wallet.use-case";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction.entity";
import { LedgerDirection } from "../../src/domain/models/wallet-ledger-entry.entity";
import { IdempotencyConflictError, WalletAlreadyExistsError } from "../../src/domain/errors/domain.error";

describe("Application Use Cases", () => {
  let walletRepo: InMemoryWalletRepository;
  let txRepo: InMemoryTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let uow: InMemoryUnitOfWork;

  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;

  beforeEach(() => {
    walletRepo = new InMemoryWalletRepository();
    txRepo = new InMemoryTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    uow = new InMemoryUnitOfWork();

    createWalletUseCase = new CreateWalletUseCase(walletRepo, txRepo, ledgerRepo, outboxRepo, uow);
    processWagerUseCase = new ProcessWagerTransactionUseCase(
      walletRepo,
      txRepo,
      ledgerRepo,
      inboxRepo,
      outboxRepo,
      uow,
    );
    reconcileWalletUseCase = new ReconcileWalletUseCase(walletRepo, ledgerRepo);
  });

  it("creates wallet with opening balance and generates OPENING tx and CREDIT ledger", async () => {
    const result = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    expect(result.playerId).toBe("player-1");
    expect(result.balance.amount).toBe("100.00");
    expect(result.version).toBe(1);

    const entries = await ledgerRepo.findAllByWalletId(result.id);
    expect(entries.length).toBe(1);
    expect(entries[0].direction).toBe(LedgerDirection.Credit);
    expect(entries[0].money.amount).toBe("100.00");
  });

  it("rejects creating duplicate wallet for same player and currency", async () => {
    await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await expect(
      createWalletUseCase.execute({
        playerId: "player-1",
        initialBalance: { amount: "50.00", currency: "BRL" },
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);
  });

  it("processes a BET, debits wallet, creates ledger and outbox events", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const betResult = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-bet-1",
      providerId: "prov-a",
      externalTransactionId: "tx-bet-1",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(betResult.balance.amount).toBe("70.00");
    expect(betResult.idempotentReplay).toBe(false);

    // Verify ledger
    const entries = await ledgerRepo.findAllByWalletId(wallet.id);
    expect(entries.length).toBe(2); // 1 OPENING + 1 BET
    expect(entries[1].direction).toBe(LedgerDirection.Debit);
    expect(entries[1].money.amount).toBe("30.00");
  });

  it("rejects BET when balance is insufficient without mutating balance or creating ledger", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "20.00", currency: "BRL" },
    });

    const result = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-bet-high",
      providerId: "prov-a",
      externalTransactionId: "tx-bet-high",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(result.balance.amount).toBe("20.00");

    const entries = await ledgerRepo.findAllByWalletId(wallet.id);
    expect(entries.length).toBe(1); // Only OPENING
  });

  it("processes LOSS without changing balance and without creating ledger entry", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const result = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-loss-1",
      providerId: "prov-a",
      externalTransactionId: "tx-loss-1",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Loss,
      money: { amount: "10.00", currency: "BRL" },
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe("100.00");

    const entries = await ledgerRepo.findAllByWalletId(wallet.id);
    expect(entries.length).toBe(1); // No new entry for LOSS
  });

  it("processes REFUND to revert a BET, crediting back the balance", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-bet-ref",
      providerId: "prov-a",
      externalTransactionId: "tx-bet-ref",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    const refundResult = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-refund-1",
      providerId: "prov-a",
      externalTransactionId: "tx-refund-1",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: "tx-bet-ref",
    });

    expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
    expect(refundResult.balance.amount).toBe("100.00");

    // Second refund on same bet must be rejected as already reversed
    const secondRefund = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-refund-2",
      providerId: "prov-a",
      externalTransactionId: "tx-refund-2",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: "tx-bet-ref",
    });

    expect(secondRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(secondRefund.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
  });

  it("handles out of order REFUND as PENDING_REFERENCE", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const result = await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-refund-ooo",
      providerId: "prov-a",
      externalTransactionId: "tx-refund-ooo",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "20.00", currency: "BRL" },
      referenceExternalTransactionId: "future-bet-tx",
    });

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
  });

  it("returns idempotent replay for repeated identical request", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const cmd = {
      idempotencyKey: "prov-a:repeat-tx",
      providerId: "prov-a",
      externalTransactionId: "repeat-tx",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    };

    const first = await processWagerUseCase.execute(cmd);
    expect(first.idempotentReplay).toBe(false);
    expect(first.balance.amount).toBe("75.00");

    const second = await processWagerUseCase.execute(cmd);
    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.balance.amount).toBe("75.00");
  });

  it("throws IdempotencyConflictError when same key has different payload", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await processWagerUseCase.execute({
      idempotencyKey: "prov-a:conflict-key",
      providerId: "prov-a",
      externalTransactionId: "conflict-key",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });

    await expect(
      processWagerUseCase.execute({
        idempotencyKey: "prov-a:conflict-key",
        providerId: "prov-a",
        externalTransactionId: "conflict-key",
        playerId: "player-1",
        walletId: wallet.id,
        roundId: "r-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" }, // Different amount!
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("reconciles wallet successfully when balance matches ledger sum", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-rec-1",
      providerId: "prov-a",
      externalTransactionId: "tx-rec-1",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "20.00", currency: "BRL" },
    });

    await processWagerUseCase.execute({
      idempotencyKey: "prov-a:tx-rec-2",
      providerId: "prov-a",
      externalTransactionId: "tx-rec-2",
      playerId: "player-1",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
    });

    const reconciliation = await reconcileWalletUseCase.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("130.00");
    expect(reconciliation.calculatedBalance.amount).toBe("130.00");
    expect(reconciliation.difference.amount).toBe("0.00");
    expect(reconciliation.checkedEntries).toBe(3); // OPENING(100) - BET(20) + WIN(50) = 130
  });
});
