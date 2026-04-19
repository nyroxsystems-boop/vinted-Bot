import { SerializedQueue } from '@vinted-system/shared';

// Single queue instance for the entire vinted-bot process.
// Playwright is NOT thread-safe, so all browser operations go through here.
export const vintedQueue = new SerializedQueue({
  scope: 'vinted-bot',
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 5 * 60 * 1000,
  jobTimeoutMs: 120_000,
});
