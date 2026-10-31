import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response, Request } from "express";
import {
  CurrencyMismatchError,
  DomainError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidMoneyError,
  InvalidReferenceError,
  ReferenceAlreadyReversedError,
  ReferenceNotFoundError,
  ReversalWouldCauseNegativeBalanceError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from "../../../domain/errors/domain.error";
import { logger } from "../../../infrastructure/observability/logger.service";

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = (request.headers["x-correlation-id"] as string) || undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_SERVER_ERROR";
    let message = "An unexpected error occurred.";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as any;
      code = res.error || "HTTP_ERROR";
      message = res.message || exception.message;
    } else if (exception instanceof DomainError) {
      code = exception.code;
      message = exception.message;

      if (exception instanceof IdempotencyConflictError || exception instanceof WalletAlreadyExistsError) {
        status = HttpStatus.CONFLICT; // 409
      } else if (exception instanceof WalletNotFoundError || exception instanceof ReferenceNotFoundError) {
        status = HttpStatus.NOT_FOUND; // 404
      } else if (exception instanceof InvalidMoneyError) {
        status = HttpStatus.BAD_REQUEST; // 400
      } else if (
        exception instanceof InsufficientFundsError ||
        exception instanceof CurrencyMismatchError ||
        exception instanceof InvalidReferenceError ||
        exception instanceof ReferenceAlreadyReversedError ||
        exception instanceof ReversalWouldCauseNegativeBalanceError
      ) {
        status = HttpStatus.UNPROCESSABLE_ENTITY; // 422
      } else {
        status = HttpStatus.BAD_REQUEST;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    logger.warn("HTTP Exception handled", {
      path: request.url,
      method: request.method,
      statusCode: status,
      code,
      message,
      correlationId,
    });

    response.status(status).json({
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
