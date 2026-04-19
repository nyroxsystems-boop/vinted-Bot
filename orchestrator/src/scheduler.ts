import { createLogger, getSetting, isPaused } from '@vinted-system/shared';
import { runPipelineCycle } from './pipeline.js';

const log = createLogger('scheduler');

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function intervalMs(): number {
  const s = Number.parseInt(getSetting('vinted_poll_interval_s') ?? '60', 10);
  return Math.max(15, s) * 1000; // hard floor of 15s
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
  }
}

export function startScheduler(): void {
  if (timer) return;
  log.info(`Scheduler starting (interval=${intervalMs() / 1000}s)`);
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
