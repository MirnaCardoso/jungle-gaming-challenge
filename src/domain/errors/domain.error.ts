export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMoneyError extends DomainError {
  readonly code = "INVALID_MONEY";
}

export class CurrencyMismatchError extends DomainError {
  readonly code = "CURRENCY_MISMATCH";
  constructor(c1: string, c2: string) {
    super(`Currency mismatch between '${c1}' and '${c2}'. Operations require identical currencies.`);
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = "INSUFFICIENT_FUNDS";
  constructor(walletId: string, currentBalance: string, attemptedAmount: string) {
    super(`Insufficient funds on wallet ${walletId}. Balance: ${currentBalance}, Attempted: ${attemptedAmount}`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = "INVALID_TRANSACTION_STATE";
  constructor(message: string) {
    super(message);
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor(key: string) {
    super(`Idempotency key '${key}' was previously used with a different payload.`);
  }
}

export class ReferenceNotFoundError extends DomainError {
  readonly code = "REFERENCE_NOT_FOUND";
  constructor(refId: string) {
    super(`Referenced transaction '${refId}' was not found.`);
  }
}

export class InvalidReferenceError extends DomainError {
  readonly code = "INVALID_REFERENCE";
  constructor(message: string) {
    super(message);
  }
}

export class ReferenceAlreadyReversedError extends DomainError {
  readonly code = "REFERENCE_ALREADY_REVERSED";
  constructor(refId: string, operation: string) {
    super(`Referenced transaction '${refId}' has already been reversed by a ${operation}.`);
  }
}

export class ReversalWouldCauseNegativeBalanceError extends DomainError {
  readonly code = "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE";
  constructor(walletId: string) {
    super(`Reversal would cause wallet '${walletId}' balance to drop below zero.`);
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = "WALLET_ALREADY_EXISTS";
  constructor(playerId: string, currency: string) {
    super(`Wallet for player '${playerId}' and currency '${currency}' already exists.`);
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = "WALLET_NOT_FOUND";
  constructor(walletId: string) {
    super(`Wallet with ID '${walletId}' not found.`);
  }
}
