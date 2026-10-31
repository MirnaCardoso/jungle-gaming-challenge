import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";

@Entity({ tableName: "outbox_messages" })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 128, name: "aggregate_id" })
  @Index({ name: "idx_outbox_aggregate_id" })
  aggregateId!: string;

  @Property({ type: "varchar", length: 128, name: "event_type" })
  eventType!: string;

  @Property({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Property({ type: "timestamptz", name: "occurred_at" })
  occurredAt: Date = new Date();

  @Property({ type: "integer", default: 0 })
  attempts!: number;

  @Property({ type: "timestamptz", nullable: true, name: "next_attempt_at" })
  @Index({ name: "idx_outbox_next_attempt" })
  nextAttemptAt?: Date;

  @Property({ type: "timestamptz", nullable: true, name: "published_at" })
  @Index({ name: "idx_outbox_published" })
  publishedAt?: Date;
}
