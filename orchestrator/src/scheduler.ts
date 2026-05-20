import { createLogger, getDb, getSetting, isPaused } from '@vinted-system/shared';
import { runPipelineCycle } from './pipeline.js';

const log = createLogger('scheduler');

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
let consecutiveIdle = 0;

function intervalMs(): number {
  const base = Number.parseInt(getSetting('vinted_poll_interval_s') ?? '60', 10);

  // Adaptive: poll faster when buyers are waiting
  try {
    const db = getDb();
    const urgent = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM chats WHERE unread > 0) AS unread_chats,
         (SELECT COUNT(*) FROM offers WHERE state = 'pending') AS pending_offers`,
    ).get() as { unread_chats: number; pending_offers: number } | undefined;

    if (urgent && (urgent.unread_chats > 0 || urgent.pending_offers > 0)) {
      consecutiveIdle = 0;
      const fast = Math.max(15, Math.floor(base * 0.5)); // half the interval
      return fast * 1000;
    }
  } catch { /* DB not ready yet — use base */ }

  // Slow down when idle for a while (saves resources)
  consecutiveIdle++;
  if (consecutiveIdle > 20) {
    return Math.min(base * 2, 120) * 1000; // max 2min when idle
  }

  return Math.max(15, base) * 1000;
}

async function tick(): Promise<void> {
  if (isRunning) return; // never overlap cycles
  if (isPaused()) return;
  isRunning = true;
  try {
    await runPipelineCycle();
  } catch (err) {
    log.error('Pipeline cycle crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
    // Re-schedule with the adaptive interval
    if (timer) {
      clearInterval(timer);
      timer = setInterval(() => void tick(), intervalMs());
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  log.info(`Scheduler starting (adaptive interval, base=${getSetting('vinted_poll_interval_s') ?? '60'}s)`);
  timer = setInterval(() => void tick(), intervalMs());
  // Also run once on start (after a short delay so bots have time to boot).
  setTimeout(() => void tick(), 5_000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Scheduler stopped');
  }
}
