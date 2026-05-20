// ──────────────────────────────────────────────────────────────────────────────
// Retry mit Exponential Backoff + Jitter
//
// Jede Playwright-Aktion sollte hierdurch laufen. Idempotente Operations:
// retry safe; non-idempotente: max 1 retry.
// ──────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Anzahl Versuche inkl. dem ersten. Default 3. */
  attempts?: number;
  /** Basis-Delay in ms. Default 500. */
  baseDelayMs?: number;
  /** Max Delay-Cap in ms. Default 10_000. */
  maxDelayMs?: number;
  /** Jitter-Anteil 0..1. Default 0.3 (±30%). */
  jitter?: number;
  /** Wenn liefert truthy → kein Retry mehr (z.B. Captcha-Block lohnt nicht). */
  abortIf?: (err: unknown) => boolean;
  /** Logger Hook. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Optional Abort signal. */
  signal?: AbortSignal;
  /** Debug label. */
  label?: string;
}

export class AbortedRetryError extends Error {
  constructor(public original: unknown, public attempts: number) {
    super(`Aborted retry after ${attempts} attempts: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'AbortedRetryError';
  }
}

export class ExhaustedRetryError extends Error {
  constructor(public original: unknown, public attempts: number) {
    super(`Exhausted ${attempts} retries: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'ExhaustedRetryError';
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    jitter = 0.3,
    abortIf,
    onRetry,
    signal,
  } = opts;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new AbortedRetryError(lastErr, i);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (abortIf?.(err)) throw new AbortedRetryError(err, i + 1);
      if (i === attempts - 1) break;
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i));
      const jit = exp * jitter * (Math.random() * 2 - 1);
      const delay = Math.max(50, Math.round(exp + jit));
      onRetry?.(i + 1, err, delay);
      await sleep(delay, signal);
    }
  }
  throw new ExhaustedRetryError(lastErr, attempts);
}
