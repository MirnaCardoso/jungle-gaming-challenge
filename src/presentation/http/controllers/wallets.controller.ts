import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  BadRequestException,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { CreateWalletSchema } from "../dto/request.dto";
import { CreateWalletUseCase } from "../../../application/use-cases/create-wallet.use-case";
import { ReconcileWalletUseCase } from "../../../application/use-cases/reconcile-wallet.use-case";
import {
  WalletLedgerRepositoryPort,
  WalletRepositoryPort,
} from "../../../application/ports/repository.ports";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    @Inject("WalletRepositoryPort") private readonly walletRepo: WalletRepositoryPort,
    @Inject("WalletLedgerRepositoryPort") private readonly ledgerRepo: WalletLedgerRepositoryPort,
  ) {}

  @Post()
  async createWallet(@Body() body: unknown) {
    const parseResult = CreateWalletSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error.errors.map((e) => e.message).join(", "));
    }

    return await this.createWalletUseCase.execute(parseResult.data);
  }

  @Get(":walletId")
  async getWallet(@Param("walletId") walletId: string) {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet '${walletId}' not found.`);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  @Get(":walletId/ledger")
  async getLedger(
    @Param("walletId") walletId: string,
    @Query("limit") limitStr?: string,
    @Query("cursor") cursor?: string,
  ) {
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10), 1), 100) : 50;
    const result = await this.ledgerRepo.findByWalletId(walletId, { limit, cursor });

    return {
      walletId,
      entries: result.entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        money: e.money.toJSON(),
        balanceBefore: e.balanceBefore.toJSON(),
        balanceAfter: e.balanceAfter.toJSON(),
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }

  @Post(":walletId/reconciliation")
  async reconcile(@Param("walletId") walletId: string) {
    return await this.reconcileWalletUseCase.execute(walletId);
  }
}
