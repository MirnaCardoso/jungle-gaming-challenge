import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryTransactionRepository,
} from "../mocks/in-memory-repositories";
import { CreateWalletUseCase } from "../../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "../../src/application/use-cases/reconcile-wallet.use-case";
import { WagerTransactionKind } from "../../src/domain/models/wager-transaction.entity";
import { WalletRepositoryPort } from "../../src/application/ports/repository.ports";
import { Wallet } from "../../src/domain/models/wallet.aggregate";

class LoadTestWalletRepository implements WalletRepositoryPort {
  private wallets = new Map<string, Wallet>();
  private locks = new Map<string, Promise<void>>();

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Wallet | null> {
    while (this.locks.has(id)) {
      await this.locks.get(id);
    }

    let release: () => void = () => {};
    const p = new Promise<void>((res) => {
      release = res;
    });

    this.locks.set(id, p);
    (this as any)[`_rel_${id}`] = release;

    return this.wallets.get(id) ?? null;
  }

  releaseLock(id: string): void {
    const rel = (this as any)[`_rel_${id}`];
    if (rel) {
      delete (this as any)[`_rel_${id}`];
      this.locks.delete(id);
      rel();
    }
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const w of this.wallets.values()) {
      if (w.playerId === playerId && w.currency === currency) return w;
    }
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
  }
}

class LoadTestUnitOfWork {
  constructor(private walletRepo: LoadTestWalletRepository) {}

  async executeInTransaction<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      for (const id of (this.walletRepo as any).wallets.keys()) {
        this.walletRepo.releaseLock(id);
      }
    }
  }
}

async function runLoadBenchmark() {
  console.log("==========================================================");
  console.log("🚀 Starting Distributed Wagering Processor Load Benchmark");
  console.log("==========================================================");

  const walletRepo = new LoadTestWalletRepository();
  const txRepo = new InMemoryTransactionRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const inboxRepo = new InMemoryInboxRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const uow = new LoadTestUnitOfWork(walletRepo);

  const createWallet = new CreateWalletUseCase(walletRepo, txRepo, ledgerRepo, outboxRepo, uow);
  const processWager = new ProcessWagerTransactionUseCase(walletRepo, txRepo, ledgerRepo, inboxRepo, outboxRepo, uow);
  const reconcile = new ReconcileWalletUseCase(walletRepo, ledgerRepo);

  const WALLET_COUNT = 10;
  const OPS_PER_WALLET = 100;
  const TOTAL_OPERATIONS = WALLET_COUNT * OPS_PER_WALLET;

  console.log(`Setting up ${WALLET_COUNT} player wallets...`);
  const wallets = await Promise.all(
    Array.from({ length: WALLET_COUNT }).map((_, i) =>
      createWallet.execute({
        playerId: `bench-player-${i}`,
        initialBalance: { amount: "10000.00", currency: "BRL" },
      }),
    ),
  );

  console.log(`Executing ${TOTAL_OPERATIONS} concurrent wagering transactions...`);
  const latencies: number[] = [];
  let successfulOps = 0;
  let rejectedOps = 0;

  const startTime = Date.now();

  const tasks: Promise<void>[] = [];
  for (let w = 0; w < WALLET_COUNT; w++) {
    const wallet = wallets[w];
    for (let op = 0; op < OPS_PER_WALLET; op++) {
      tasks.push(
        (async () => {
          const t0 = performance.now();
          const kind = op % 3 === 0 ? WagerTransactionKind.Bet : op % 3 === 1 ? WagerTransactionKind.Win : WagerTransactionKind.Loss;
          const result = await processWager.execute({
            idempotencyKey: `bench:tx-${w}-${op}`,
            providerId: "bench-provider",
            externalTransactionId: `bench-${w}-${op}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `round-${op}`,
            gameId: "slots-bench",
            kind,
            money: { amount: "10.00", currency: "BRL" },
          });

          const elapsed = performance.now() - t0;
          latencies.push(elapsed);

          if (result.status === "PROCESSED") successfulOps++;
          else rejectedOps++;
        })(),
      );
    }
  }

  await Promise.all(tasks);
  const totalDurationMs = Date.now() - startTime;

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const throughput = Math.round((TOTAL_OPERATIONS / (totalDurationMs / 1000)) * 100) / 100;

  console.log("\n=================== BENCHMARK RESULTS ===================");
  console.log(`Total Operations:    ${TOTAL_OPERATIONS}`);
  console.log(`Successful:          ${successfulOps}`);
  console.log(`Rejected (Business): ${rejectedOps}`);
  console.log(`Duration:            ${totalDurationMs} ms`);
  console.log(`Throughput:          ${throughput} ops/sec`);
  console.log(`Latency p50:         ${p50.toFixed(2)} ms`);
  console.log(`Latency p95:         ${p95.toFixed(2)} ms`);
  console.log(`Latency p99:         ${p99.toFixed(2)} ms`);
  console.log("---------------------------------------------------------");

  console.log("Verifying final ledger reconciliation consistency across all wallets...");
  let allConsistent = true;
  for (const wallet of wallets) {
    const rec = await reconcile.execute(wallet.id);
    if (!rec.consistent) {
      allConsistent = false;
      console.error(`Inconsistency found on wallet ${wallet.id}! Difference: ${rec.difference.amount}`);
    }
  }

  if (allConsistent) {
    console.log("✅ All wallets verified: 100% consistent with ledger (Stored Balance == Ledger Sum).");
  } else {
    console.error("❌ Reconciliation failed for one or more wallets.");
    process.exit(1);
  }
  console.log("=========================================================\n");
}

runLoadBenchmark().catch((err) => {
  console.error("Load benchmark error:", err);
  process.exit(1);
});
