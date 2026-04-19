// ──────────────────────────────────────────────────────────────────────────────
// Serialized request queue + circuit breaker.
// Adapted from Catalog-Scraper/src/requestQueue.ts — Playwright is NOT thread-safe,
// so only ONE job runs at a time per bot.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from './logger.js';

interface QueueItem<T> {
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (r: unknown) => void;
  label: string;
  addedAt: number;
  priority: 'high' | 'low';
}

export interface QueueStats {
  pending: number;
  isProcessing: boolean;
  circuitBreakerOpen: boolean;
  consecutiveFailures: number;
  totalProcessed: number;
  totalFailed: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface QueueOptions {
  scope: string;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
  jobTimeoutMs?: number;
}

export class SerializedQueue {
  private readonly log = createLogger('queue');
  private readonly scope: string;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly jobTimeoutMs: number;

  private queue: QueueItem<unknown>[] = [];
  private isProcessing = false;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;
  private totalProcessed = 0;
  private totalFailed = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;

  constructor(opts: QueueOptions) {
    this.scope = opts.scope;
    this.threshold = opts.circuitBreakerThreshold ?? 5;
    this.resetMs = opts.circuitBreakerResetMs ?? 5 * 60 * 1000;
    this.jobTimeoutMs = opts.jobTimeoutMs ?? 300_000;
  }

  enqueue<T>(fn: () => Promise<T>, label: string, priority: 'high' | 'low' = 'high'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.isCircuitOpen()) {
        const remaining = this.circuitOpenedAt
          ? this.resetMs - (Date.now() - this.circuitOpenedAt)
          : 0;
        reject(new Error(`[${this.scope}] Circuit breaker OPEN — retry in ${Math.ceil(remaining / 1000)}s`));
        return;
      }

      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        label,
        addedAt: Date.now(),
        priority,
      });

      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
        return a.addedAt - b.addedAt;
      });

      this.log.debug(`[${this.scope}] Queued "${label}" (size=${this.queue.length})`);
      void this.processNext();
    });
  }

  private isCircuitOpen(): boolean {
    if (this.consecutiveFailures < this.threshold) return false;
    if (!this.circuitOpenedAt) return false;
    const elapsed = Date.now() - this.circuitOpenedAt;
    if (elapsed >= this.resetMs) {
      this.log.info(`[${this.scope}] Circuit half-open — allowing probe`);
      return false;
    }
    return true;
  }

  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
    this.log.info(`[${this.scope}] Circuit breaker reset`);
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
    this.totalProcessed++;
    this.lastSuccessAt = Date.now();
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    this.totalFailed++;
    this.lastFailureAt = Date.now();
    if (this.consecutiveFailures >= this.threshold && !this.circuitOpenedAt) {
      this.circuitOpenedAt = Date.now();
      this.log.error(`[${this.scope}] ⛔ Circuit OPEN (${this.consecutiveFailures} failures)`);
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.shift()!;
    const waited = Date.now() - item.addedAt;
    this.log.info(`[${this.scope}] ▶ "${item.label}" (waited=${waited}ms, rest=${this.queue.length})`);

    try {
      const result = await Promise.race([
        item.fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout ${this.jobTimeoutMs}ms`)), this.jobTimeoutMs),
        ),
      ]);
      this.recordSuccess();
      item.resolve(result);
    } catch (err) {
      this.recordFailure();
      this.log.error(`[${this.scope}] ✗ "${item.label}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
      item.reject(err);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => void this.processNext(), 100);
      }
    }
  }

  stats(): QueueStats {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      circuitBreakerOpen: this.isCircuitOpen(),
      consecutiveFailures: this.consecutiveFailures,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
    };
  }

  depth(): number {
    return this.queue.length;
  }
}
