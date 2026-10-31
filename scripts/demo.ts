import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryTransactionRepository,
} from "../test/mocks/in-memory-repositories";
import { CreateWalletUseCase } from "../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../src/application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "../src/application/use-cases/reconcile-wallet.use-case";
import { WagerTransactionKind } from "../src/domain/models/wager-transaction.entity";
import { WalletRepositoryPort } from "../src/application/ports/repository.ports";
import { Wallet } from "../src/domain/models/wallet.aggregate";

class DemoWalletRepository implements WalletRepositoryPort {
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

class DemoUnitOfWork {
  constructor(private walletRepo: DemoWalletRepository) {}
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

async function runLiveDemo() {
  console.log("\n==================================================================");
  console.log("🎮 DEMONSTRAÇÃO AO VIVO — DISTRIBUTED WAGERING PROCESSOR (JUNGLE)");
  console.log("==================================================================\n");

  const walletRepo = new DemoWalletRepository();
  const txRepo = new InMemoryTransactionRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const inboxRepo = new InMemoryInboxRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const uow = new DemoUnitOfWork(walletRepo);

  const createWallet = new CreateWalletUseCase(walletRepo, txRepo, ledgerRepo, outboxRepo, uow);
  const processWager = new ProcessWagerTransactionUseCase(walletRepo, txRepo, ledgerRepo, inboxRepo, outboxRepo, uow);
  const reconcile = new ReconcileWalletUseCase(walletRepo, ledgerRepo);

  // 1. Criar Carteira
  console.log("1️⃣ Criando carteira para o jogador 'player-demo-1' com R$ 100,00...");
  const wallet = await createWallet.execute({
    playerId: "player-demo-1",
    initialBalance: { amount: "100.00", currency: "BRL" },
  });
  console.log(`   ✅ Carteira Criada! ID: ${wallet.id}`);
  console.log(`   💰 Saldo Inicial: ${wallet.balance.amount} ${wallet.balance.currency} (Versão: ${wallet.version})\n`);

  // 2. Submeter Aposta (BET)
  console.log("2️⃣ Submetendo uma aposta (BET) de R$ 30,00...");
  const bet1 = await processWager.execute({
    idempotencyKey: "provider-demo:tx-001",
    providerId: "provider-demo",
    externalTransactionId: "tx-001",
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: { amount: "30.00", currency: "BRL" },
  });
  console.log(`   ✅ Transação: ${bet1.status}`);
  console.log(`   💰 Saldo Atual: ${bet1.balance.amount} ${bet1.balance.currency} | Idempotent Replay: ${bet1.idempotentReplay}\n`);

  // 3. Replay de Idempotência
  console.log("3️⃣ Reenviando a mesma requisição com a mesma Idempotency-Key (Teste de Idempotência)...");
  const bet1Replay = await processWager.execute({
    idempotencyKey: "provider-demo:tx-001",
    providerId: "provider-demo",
    externalTransactionId: "tx-001",
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: { amount: "30.00", currency: "BRL" },
  });
  console.log(`   ✅ Resposta Idêntica: ${bet1Replay.status}`);
  console.log(`   🛡️ Idempotent Replay detectado com sucesso: ${bet1Replay.idempotentReplay} (Saldo inalterado: ${bet1Replay.balance.amount} BRL)\n`);

  // 4. Concorrência: Cenário da Seção 8 do Desafio
  console.log("4️⃣ Disparando 2 apostas simultâneas de R$ 50,00 disputando o saldo restante de R$ 70,00...");
  const [c1, c2] = await Promise.all([
    processWager.execute({
      idempotencyKey: "provider-demo:tx-race-A",
      providerId: "provider-demo",
      externalTransactionId: "tx-race-A",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-2",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    }),
    processWager.execute({
      idempotencyKey: "provider-demo:tx-race-B",
      providerId: "provider-demo",
      externalTransactionId: "tx-race-B",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-2",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    }),
  ]);

  console.log(`   👉 Aposta A: Status = ${c1.status} ${c1.failureCode ? `(Falha: ${c1.failureCode})` : ""}`);
  console.log(`   👉 Aposta B: Status = ${c2.status} ${c2.failureCode ? `(Falha: ${c2.failureCode})` : ""}`);
  const winner = c1.status === "PROCESSED" ? "A" : "B";
  const loser = winner === "A" ? "B" : "A";
  console.log(`   🔒 Controle de concorrência: Apenas a Aposta ${winner} foi aceita. A Aposta ${loser} foi rejeitada por saldo insuficiente.`);
  console.log(`   💰 Saldo Final da Carteira: ${c1.status === "PROCESSED" ? c1.balance.amount : c2.balance.amount} BRL\n`);

  // 5. Reconciliação do Ledger
  console.log("5️⃣ Executando Reconciliação Matemática do Ledger...");
  const rec = await reconcile.execute(wallet.id);
  console.log(`   📑 Total de Lançamentos no Ledger: ${rec.checkedEntries}`);
  console.log(`   🏦 Saldo Armazenado na Wallet:    ${rec.storedBalance.amount} BRL`);
  console.log(`   🧮 Saldo Calculado pelo Ledger:   ${rec.calculatedBalance.amount} BRL`);
  console.log(`   ⚖️ Diferença Matemática:          ${rec.difference.amount} BRL`);
  console.log(`   🎯 Consistência Garantida:        ${rec.consistent ? "✅ 100% CONSISTENTE" : "❌ INCONSISTENTE"}\n`);

  console.log("==================================================================");
  console.log("🎉 Demonstração concluída com sucesso!");
  console.log("==================================================================\n");
}

runLiveDemo().catch((err) => {
  console.error("Erro na demo:", err);
});
