import { SerializedQueue } from '@vinted-system/shared';

export const temuQueue = new SerializedQueue({
  scope: 'temu-bot',
  circuitBreakerThreshold: 3, // stricter — failed orders cost money
  circuitBreakerResetMs: 10 * 60 * 1000, // longer cooldown
  jobTimeoutMs: 180_000,
});
