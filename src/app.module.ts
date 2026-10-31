import { Module, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { EntityManager } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./infrastructure/database/mikro-orm.config";
import { WalletsController } from "./presentation/http/controllers/wallets.controller";
import { WageringController } from "./presentation/http/controllers/wagering.controller";
import { HealthController } from "./presentation/http/controllers/health.controller";
import { CreateWalletUseCase } from "./application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "./application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "./application/use-cases/reconcile-wallet.use-case";
import {
  MikroOrmInboxRepository,
  MikroOrmLedgerRepository,
  MikroOrmOutboxRepository,
  MikroOrmTransactionRepository,
  MikroOrmUnitOfWork,
  MikroOrmWalletRepository,
} from "./infrastructure/database/repositories/mikro-orm.repositories";
import { SqsService } from "./infrastructure/messaging/sqs.service";
import { logger } from "./infrastructure/observability/logger.service";

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [WalletsController, WageringController, HealthController],
  providers: [
    {
      provide: "WalletRepositoryPort",
      useFactory: (em: EntityManager) => new MikroOrmWalletRepository(em),
      inject: [EntityManager],
    },
    {
      provide: "WagerTransactionRepositoryPort",
      useFactory: (em: EntityManager) => new MikroOrmTransactionRepository(em),
      inject: [EntityManager],
    },
    {
      provide: "WalletLedgerRepositoryPort",
      useFactory: (em: EntityManager) => new MikroOrmLedgerRepository(em),
      inject: [EntityManager],
    },
    {
      provide: "InboxRepositoryPort",
      useFactory: (em: EntityManager) => new MikroOrmInboxRepository(em),
      inject: [EntityManager],
    },
    {
      provide: "OutboxRepositoryPort",
      useFactory: (em: EntityManager) => new MikroOrmOutboxRepository(em),
      inject: [EntityManager],
    },
    {
      provide: "UnitOfWorkPort",
      useFactory: (em: EntityManager) => new MikroOrmUnitOfWork(em),
      inject: [EntityManager],
    },
    {
      provide: CreateWalletUseCase,
      useFactory: (walletRepo, txRepo, ledgerRepo, outboxRepo, uow) =>
        new CreateWalletUseCase(walletRepo, txRepo, ledgerRepo, outboxRepo, uow),
      inject: [
        "WalletRepositoryPort",
        "WagerTransactionRepositoryPort",
        "WalletLedgerRepositoryPort",
        "OutboxRepositoryPort",
        "UnitOfWorkPort",
      ],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (walletRepo, txRepo, ledgerRepo, inboxRepo, outboxRepo, uow) =>
        new ProcessWagerTransactionUseCase(walletRepo, txRepo, ledgerRepo, inboxRepo, outboxRepo, uow),
      inject: [
        "WalletRepositoryPort",
        "WagerTransactionRepositoryPort",
        "WalletLedgerRepositoryPort",
        "InboxRepositoryPort",
        "OutboxRepositoryPort",
        "UnitOfWorkPort",
      ],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (walletRepo, ledgerRepo) => new ReconcileWalletUseCase(walletRepo, ledgerRepo),
      inject: ["WalletRepositoryPort", "WalletLedgerRepositoryPort"],
    },
    {
      provide: SqsService,
      useFactory: (processUseCase) => new SqsService(processUseCase),
      inject: [ProcessWagerTransactionUseCase],
    },
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly sqsService: SqsService) {}

  onModuleInit() {
    // Start background SQS consumer polling
    if (process.env.ENABLE_SQS_CONSUMER === "true") {
      this.sqsService.startPolling();
    }
  }

  async onModuleDestroy() {
    logger.info("Application shutting down, stopping background services...");
    await this.sqsService.stopPolling();
  }
}
