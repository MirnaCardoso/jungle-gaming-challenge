import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import { ProcessWagerTransactionUseCase } from "../../application/use-cases/process-wager-transaction.use-case";
import { logger } from "../observability/logger.service";
import { metrics } from "../observability/metrics.service";
import { DomainError } from "../../domain/errors/domain.error";

export class SqsService {
  private readonly sqsClient: SQSClient;
  private isRunning = false;
  private activeProcessingCount = 0;

  private readonly queueUrl: string;
  private readonly dlqUrl: string;

  constructor(
    private readonly processUseCase: ProcessWagerTransactionUseCase,
    endpoint?: string,
  ) {
    this.queueUrl = process.env.SQS_MAIN_QUEUE_URL || "http://localhost:4566/000000000000/wager-transactions.fifo";
    this.dlqUrl = process.env.SQS_DLQ_QUEUE_URL || "http://localhost:4566/000000000000/wager-transactions-dlq.fifo";

    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: endpoint || process.env.AWS_ENDPOINT || "http://localhost:4566",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
  }

  startPolling(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("SQS Consumer started polling", { queueUrl: this.queueUrl });
    this.pollLoop().catch((err) => {
      logger.error("Unexpected error in SQS pollLoop", err);
    });
  }

  async stopPolling(): Promise<void> {
    this.isRunning = false;
    logger.info("Stopping SQS Consumer... waiting for active processing to finish", {
      activeProcessingCount: this.activeProcessingCount,
    });

    const start = Date.now();
    while (this.activeProcessingCount > 0 && Date.now() - start < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    logger.info("SQS Consumer gracefully stopped");
  }

  async publishToQueue(queueUrl: string, body: Record<string, unknown>, messageGroupId?: string, deduplicationId?: string): Promise<void> {
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
        MessageGroupId: messageGroupId || "default-group",
        MessageDeduplicationId: deduplicationId,
      }),
    );
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 5,
            WaitTimeSeconds: 2, // Long polling
            VisibilityTimeout: 30,
            MessageSystemAttributeNames: ["ApproximateReceiveCount"],
          }),
        );

        if (response.Messages && response.Messages.length > 0) {
          for (const msg of response.Messages) {
            if (!this.isRunning) {
              // Return visibility immediately so another instance can process it
              if (msg.ReceiptHandle) {
                await this.sqsClient.send(
                  new ChangeMessageVisibilityCommand({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: msg.ReceiptHandle,
                    VisibilityTimeout: 0,
                  }),
                );
              }
              break;
            }

            this.activeProcessingCount++;
            this.handleMessage(msg)
              .finally(() => {
                this.activeProcessingCount--;
              })
              .catch((err) => {
                logger.error("Unhandled error processing message", err, { messageId: msg.MessageId });
              });
          }
        }
      } catch (err: any) {
        if (!this.isRunning) break;
        logger.warn("Transient error while polling SQS", { error: err?.message });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    const startTime = Date.now();
    const receiveCount = Number(msg.Attributes?.ApproximateReceiveCount || "1");

    try {
      const parsed = JSON.parse(msg.Body || "{}");
      const { messageId, data } = parsed;

      if (!data || !messageId) {
        throw new Error("Invalid message format: missing messageId or data");
      }

      logger.info("Processing SQS message", {
        messageId,
        walletId: data.walletId,
        providerId: data.providerId,
        transactionId: data.externalTransactionId,
      });

      // Execute unified use case
      const result = await this.processUseCase.execute({
        idempotencyKey: data.idempotencyKey || `${data.providerId}:${data.externalTransactionId}`,
        providerId: data.providerId,
        externalTransactionId: data.externalTransactionId,
        playerId: data.playerId,
        walletId: data.walletId,
        roundId: data.roundId,
        gameId: data.gameId,
        kind: data.kind,
        money: data.money,
        referenceExternalTransactionId: data.referenceExternalTransactionId,
        correlationId: messageId,
        inboxContext: {
          consumerName: "sqs-wagering-consumer",
          messageId,
        },
      });

      // Business outcome was committed to database -> ACK message!
      await this.ackMessage(msg.ReceiptHandle);
      metrics.recordTransaction(result.status);
      metrics.recordProcessingLatency(Date.now() - startTime);

      if (result.idempotentReplay) {
        metrics.recordDuplicate();
      }
    } catch (err: any) {
      if (err instanceof DomainError) {
        // Business logic rejection is terminal: ACK message so it does not loop
        logger.info("Business domain rejection on SQS message. ACKing message.", {
          code: err.code,
          message: err.message,
        });
        await this.ackMessage(msg.ReceiptHandle);
        metrics.recordTransaction("REJECTED");
        return;
      }

      // Transient or infrastructure error
      metrics.recordRetry();
      logger.error("Infrastructure error processing SQS message", err, { receiveCount });

      if (receiveCount >= 3) {
        // Exceeded retries -> send to DLQ and ACK from main queue
        logger.error("Message exceeded maximum retries, moving to DLQ", { messageId: msg.MessageId });
        metrics.recordDlqMessage();
        try {
          await this.publishToQueue(this.dlqUrl, JSON.parse(msg.Body || "{}"));
          await this.ackMessage(msg.ReceiptHandle);
        } catch (dlqErr) {
          logger.error("Failed to forward message to DLQ", dlqErr);
        }
      }
    }
  }

  private async ackMessage(receiptHandle: string): Promise<void> {
    if (!receiptHandle) return;
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
