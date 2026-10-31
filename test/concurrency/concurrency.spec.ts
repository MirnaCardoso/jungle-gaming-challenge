import { beforeEach, describe, expect, it } from "bun:test";
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryTransactionRepository,
} from "../mocks/in-memory-repositories";
import { WalletRepositoryPort } from "../../src/application/ports/repository.ports";
import { Wallet } from "../../src/domain/models/wallet.aggregate";
import { CreateWalletUseCase } from "../../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "../../src/application/use-cases/reconcile-wallet.use-case";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction.entity";
import { Money } from "../../src/domain/models/money.vo";
import { LedgerDirection } from "../../src/domain/models/wallet-ledger-entry.entity";

/**
 * Repository that simulates PostgreSQL SELECT ... FOR UPDATE per walletId using an async lock per wallet.
 * Ensures strict sequential execution per walletId without global locking.
 */
class ConcurrentWalletRepository implements WalletRepositoryPort {
  private wallets = new Map<string, Wallet>();
  private locks = new Map<string, Promise<void>>();

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Wallet | null> {
    // Acquire lock for this specific walletId
    while (this.locks.has(id)) {
      await this.locks.get(id);
    }

    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(id, lockPromise);
    (this as any)._currentRelease = releaseLock;

    return this.wallets.get(id) ?? null;
  }

  releaseLock(id: string): void {
    const release = (this as any)._currentRelease;
    if (release) {
      this.locks.delete(id);
      release();
    }
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const w of this.wallets.values()) {
      if (w.playerId === playerId && w.currency === currency) {
        return w;
      }
    }
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
  }
}

class LockingUnitOfWork {
  constructor(private walletRepo: ConcurrentWalletRepository) {}

  async executeInTransaction<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      // Release any acquired locks
      for (const walletId of (this.walletRepo as any).wallets.keys()) {
        this.walletRepo.releaseLock(walletId);
      }
    }
  }
}

describe("Concurrency & Race Conditions", () => {
  let walletRepo: ConcurrentWalletRepository;
  let txRepo: InMemoryTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let uow: any;

  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;

  beforeEach(() => {
    walletRepo = new ConcurrentWalletRepository();
    txRepo = new InMemoryTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    uow = new LockingUnitOfWork(walletRepo);

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

  it("Section 8 Mandatory Scenario: two concurrent bets of 80.00 BRL on 100.00 BRL balance", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-section-8",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const bet1 = {
      idempotencyKey: "prov-a:bet-1",
      providerId: "prov-a",
      externalTransactionId: "bet-1",
      playerId: "player-section-8",
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    const bet2 = {
      idempotencyKey: "prov-a:bet-2",
      providerId: "prov-a",
      externalTransactionId: "bet-2",
      playerId: "player-section-8",
      walletId: wallet.id,
      roundId: "r-2",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    // Run simultaneously in parallel
    const [res1, res2] = await Promise.all([
      processWagerUseCase.execute(bet1),
      processWagerUseCase.execute(bet2),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(WagerTransactionStatus.Processed);
    expect(statuses).toContain(WagerTransactionStatus.Rejected);

    const rejected = res1.status === WagerTransactionStatus.Rejected ? res1 : res2;
    expect(rejected.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

    // Final balance must be exactly 20.00 BRL
    const updatedWallet = await walletRepo.findById(wallet.id);
    expect(updatedWallet?.balance.amount).toBe("20.00");

    // Exactly one debit entry in the ledger (plus the opening credit)
    const ledgerEntries = await ledgerRepo.findAllByWalletId(wallet.id);
    const debitEntries = ledgerEntries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debitEntries.length).toBe(1);
    expect(debitEntries[0].money.amount).toBe("80.00");

    // Invariant: wallet.balance === ledger balance
    const reconciliation = await reconcileWalletUseCase.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("20.00");
    expect(reconciliation.calculatedBalance.amount).toBe("20.00");
    expect(reconciliation.difference.amount).toBe("0.00");
  });

  it("Section 13 Concurrency Test: 50 identical bet requests in parallel result in exactly one debit", async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: "player-50-parallel",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const identicalRequest = {
      idempotencyKey: "prov-a:identical-50",
      providerId: "prov-a",
      externalTransactionId: "identical-50",
      playerId: "player-50-parallel",
      walletId: wallet.id,
      roundId: "r-50",
      gameId: "game-50",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    };

    // 50 parallel invocations of the exact same request
    const promises = Array.from({ length: 50 }).map(() =>
      processWagerUseCase.execute(identicalRequest),
    );

    const results = await Promise.all(promises);

    // All should report success (either original or idempotent replay)
    for (const res of results) {
      expect(res.status).toBe(WagerTransactionStatus.Processed);
      expect(res.balance.amount).toBe("70.00");
    }

    // Exactly one was original, 49 were idempotent replays
    const replays = results.filter((r) => r.idempotentReplay);
    const originals = results.filter((r) => !r.idempotentReplay);

    expect(originals.length).toBe(1);
    expect(replays.length).toBe(49);

    // Final balance is 70.00 BRL
    const finalWallet = await walletRepo.findById(wallet.id);
    expect(finalWallet?.balance.amount).toBe("70.00");

    // Ledger has exactly 1 debit entry
    const entries = await ledgerRepo.findAllByWalletId(wallet.id);
    const debits = entries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debits.length).toBe(1);

    // Final invariant
    const rec = await reconcileWalletUseCase.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.difference.amount).toBe("0.00");
  });
});
