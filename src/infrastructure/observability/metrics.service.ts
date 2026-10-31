export interface MetricsSnapshot {
  transactionsByStatus: Record<string, number>;
  duplicatesDetected: number;
  retries: number;
  messagesInDlq: number;
  lockConflicts: number;
  outboxLag: number;
  processingLatencyMs: {
    count: number;
    totalMs: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

export class MetricsService {
  private transactionsByStatus: Record<string, number> = {
    PROCESSED: 0,
    REJECTED: 0,
    PENDING_REFERENCE: 0,
    FAILED: 0,
  };

  private duplicatesDetected = 0;
  private retries = 0;
  private messagesInDlq = 0;
  private lockConflicts = 0;
  private outboxLag = 0;
  private latencies: number[] = [];

  recordTransaction(status: string): void {
    this.transactionsByStatus[status] = (this.transactionsByStatus[status] || 0) + 1;
  }

  recordDuplicate(): void {
    this.duplicatesDetected++;
  }

  recordRetry(): void {
    this.retries++;
  }

  recordDlqMessage(): void {
    this.messagesInDlq++;
  }

  recordLockConflict(): void {
    this.lockConflicts++;
  }

  setOutboxLag(count: number): void {
    this.outboxLag = count;
  }

  recordProcessingLatency(ms: number): void {
    this.latencies.push(ms);
    // Keep sliding window of last 1000 latencies
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  getSnapshot(): MetricsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const count = sorted.length;
    const totalMs = sorted.reduce((sum, v) => sum + v, 0);

    const p50 = count > 0 ? sorted[Math.floor(count * 0.5)] : 0;
    const p95 = count > 0 ? sorted[Math.floor(count * 0.95)] : 0;
    const p99 = count > 0 ? sorted[Math.floor(count * 0.99)] : 0;

    return {
      transactionsByStatus: { ...this.transactionsByStatus },
      duplicatesDetected: this.duplicatesDetected,
      retries: this.retries,
      messagesInDlq: this.messagesInDlq,
      lockConflicts: this.lockConflicts,
      outboxLag: this.outboxLag,
      processingLatencyMs: {
        count,
        totalMs,
        p50,
        p95,
        p99,
      },
    };
  }
}

export const metrics = new MetricsService();
