import { Money, MoneyProps } from "./money.vo";
import { LedgerDirection } from "./wallet-ledger-entry.entity";
import { InvalidTransactionStateError } from "../errors/domain.error";

export enum WagerTransactionKind {
  Opening  = "OPENING",   // interno: crédito de abertura da wallet
  Bet      = "BET",
  Win      = "WIN",
  Loss     = "LOSS",
  Refund   = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending          = "PENDING",            // aceita, ainda não aplicada
  PendingReference = "PENDING_REFERENCE",  // aguardando a transação referenciada
  Processed        = "PROCESSED",          // aplicada (terminal)
  Rejected         = "REJECTED",           // violação de regra de negócio (terminal)
  Failed           = "FAILED",             // erro permanente de infraestrutura (terminal, auditável)
}

export enum FailureCode {
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  REFERENCE_NOT_FOUND = "REFERENCE_NOT_FOUND",
  REFERENCE_PENDING_EXPIRED = "REFERENCE_PENDING_EXPIRED",
  INVALID_REFERENCE_KIND = "INVALID_REFERENCE_KIND",
  REFERENCE_MISMATCH = "REFERENCE_MISMATCH",
  REFERENCE_ALREADY_REVERSED = "REFERENCE_ALREADY_REVERSED",
  REFERENCE_AMOUNT_MISMATCH = "REFERENCE_AMOUNT_MISMATCH",
  REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE = "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE",
  IDEMPOTENCY_PAYLOAD_MISMATCH = "IDEMPOTENCY_PAYLOAD_MISMATCH",
  CURRENCY_MISMATCH = "CURRENCY_MISMATCH",
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  createdAt: Date;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!props.id) throw new Error("Transaction ID is required.");
    if (!props.providerId) throw new Error("Provider ID is required.");
    if (!props.externalTransactionId) throw new Error("External transaction ID is required.");
    if (!props.idempotencyKey) throw new Error("Idempotency key is required.");
    if (!props.payloadHash) throw new Error("Payload hash is required.");
    if (!props.walletId) throw new Error("Wallet ID is required.");
    if (!props.playerId) throw new Error("Player ID is required.");
    if (!props.roundId) throw new Error("Round ID is required.");
    if (!props.gameId) throw new Error("Game ID is required.");
    if (!props.kind) throw new Error("Transaction kind is required.");
    if (!props.money) throw new Error("Money is required.");

    // Validate reference requirements
    if (
      (props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback) &&
      (!props.referenceExternalTransactionId || props.referenceExternalTransactionId.trim() === "")
    ) {
      throw new Error(`Transaction of kind ${props.kind} requires referenceExternalTransactionId.`);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    if (referenceTransactionId) {
      this._referenceTransactionId = referenceTransactionId;
    }
    this._processedAt = at;
  }

  markPendingReference(): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    if (this._status === WagerTransactionStatus.Rejected || this._status === WagerTransactionStatus.Failed) {
      return false;
    }
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new Error("Reference transaction is required to determine ledger direction for ROLLBACK.");
        }
        const refDir = reference.ledgerDirectionFor();
        return refDir === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new Error("LOSS does not produce a ledger entry.");
    }
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot transition transaction ${this.id} from terminal status ${this._status}.`,
      );
    }
  }

  toState(): WagerTransactionState {
    return {
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      money: this.money.toJSON(),
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this._referenceTransactionId,
      status: this._status,
      failureCode: this._failureCode,
      createdAt: this.createdAt,
      processedAt: this._processedAt,
    };
  }
}
