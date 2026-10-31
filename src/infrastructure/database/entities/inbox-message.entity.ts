import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "inbox_messages" })
export class InboxMessageEntity {
  @PrimaryKey({ type: "varchar", length: 128, name: "consumer_name" })
  consumerName!: string;

  @PrimaryKey({ type: "varchar", length: 128, name: "message_id" })
  messageId!: string;

  @Property({ type: "varchar", length: 64, name: "payload_hash" })
  payloadHash!: string;

  @Property({ type: "timestamptz", name: "received_at" })
  receivedAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true, name: "processed_at" })
  processedAt?: Date;
}
