import pino from "pino";

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: unknown;
}

export class AppLogger {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: [
          "*.password",
          "*.secret",
          "*.creditCard",
          "*.authorization",
          "*.token",
          "headers.authorization",
          "payload.cardNumber",
        ],
        censor: "[REDACTED]",
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(context || {}, message);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(context || {}, message);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errObj = error instanceof Error ? { err: { message: error.message, stack: error.stack } } : { err: error };
    this.logger.error({ ...errObj, ...(context || {}) }, message);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(context || {}, message);
  }
}

export const logger = new AppLogger();
