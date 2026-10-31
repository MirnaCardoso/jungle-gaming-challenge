import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  BadRequestException,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { SubmitTransactionSchema } from "../dto/request.dto";
import { ProcessWagerTransactionUseCase } from "../../../application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionRepositoryPort } from "../../../application/ports/repository.ports";

@Controller()
export class WageringController {
  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    @Inject("WagerTransactionRepositoryPort") private readonly txRepo: WagerTransactionRepositoryPort,
  ) {}

  @Post("wagering/transactions")
  async submitTransaction(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
    @Headers("x-correlation-id") correlationIdHeader?: string,
  ) {
    if (!idempotencyKeyHeader || idempotencyKeyHeader.trim() === "") {
      throw new BadRequestException("Header 'Idempotency-Key' is required.");
    }

    const parseResult = SubmitTransactionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error.errors.map((e) => e.message).join(", "));
    }

    const data = parseResult.data;

    return await this.processWagerUseCase.execute({
      idempotencyKey: idempotencyKeyHeader.trim(),
      providerId: data.providerId,
      externalTransactionId: data.externalTransactionId,
      playerId: data.playerId,
      walletId: data.walletId,
      roundId: data.roundId,
      gameId: data.gameId,
      kind: data.kind,
      money: data.money,
      referenceExternalTransactionId: data.referenceExternalTransactionId,
      correlationId: correlationIdHeader,
    });
  }

  @Get("wagering/transactions/:transactionId")
  async getTransactionById(@Param("transactionId") transactionId: string) {
    const tx = await this.txRepo.findById(transactionId);
    if (!tx) {
      throw new NotFoundException(`Transaction '${transactionId}' not found.`);
    }

    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async getTransactionByProviderAndExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const tx = await this.txRepo.findByProviderAndExternalId(providerId, externalTransactionId);
    if (!tx) {
      throw new NotFoundException(
        `Transaction '${externalTransactionId}' for provider '${providerId}' not found.`,
      );
    }

    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
