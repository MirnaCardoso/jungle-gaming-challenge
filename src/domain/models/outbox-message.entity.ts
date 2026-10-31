import { v4 as uuidv4 } from "uuid";
import { IntegrationEvent } from "../events/integration-event.base";

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const json = event.toJSON();
    return new OutboxMessage(
      uuidv4(),
      event.aggregateId,
      event.eventType,
      json as Record<string, unknown>,
      event.occurredAt,
      0,
      new Date(), // Due immediately
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      Object.freeze({ ...state.payload }),
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt <= now;
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
  }

  /** Incrementa attempts e calcula o próximo nextAttemptAt com backoff exponencial */
  scheduleRetry(now: Date): void {
    this._attempts += 1;
    // Exponential backoff: 2^attempts * 500ms, capped at 60s
    const delayMs = Math.min(Math.pow(2, this._attempts) * 500, 60000);
    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  toState(): OutboxMessageState {
    return {
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload as Record<string, unknown>,
      occurredAt: this.occurredAt,
      attempts: this._attempts,
      nextAttemptAt: this._nextAttemptAt,
      publishedAt: this._publishedAt,
    };
  }
}
