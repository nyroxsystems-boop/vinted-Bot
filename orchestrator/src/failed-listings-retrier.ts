// ──────────────────────────────────────────────────────────────────────────────
// Failed-Listings-Retrier
//
// Auto-Publisher marks listings 'failed' on publish errors and stops touching
// them. Many failures are transient (network blip, brief Vinted slowdown,
// Playwright timeout). This worker retries them with exponential backoff:
//
//   retry 1 after 30 min
//   retry 2 after 2  h
//   retry 3 after 6  h
//   then → status 'archived' + manual-review alert
//
// Skipped for failures we KNOW can't be transient: missing photos, invalid
// address (those need user action), CAPTCHA (account-level issue).
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, isPaused, withLock } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('failed-retrier');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 15 * 60 * 1000;
const MAX_RETRIES = 3;

// Errors not worth retrying — they need human intervention.
const TERMINAL_PATTERNS = [
  /insufficient photos/i,
  /missing photo files/i,
  /invalid buyer address/i,
  /\[captcha\]/i,
];

function backoffHours(retryCount: number): number {
  // retry 0 → 0.5h, 1 → 2h, 2 → 6h
  return [0.5, 2, 6][retryCount] ?? 24;
}

function tickInner(): void {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, folder_num, retry_count, last_error, last_retry_at
      FROM auto_listings
     WHERE status = 'failed'
       AND retry_count < ?
       AND (last_retry_at IS NULL
            OR last_retry_at < datetime('now', '-30 minutes'))
     ORDER BY updated_at ASC
     LIMIT 20
  `).all(MAX_RETRIES) as Array<{
    id: number;
    title: string;
    folder_num: number;
    retry_count: number;
    last_error: string | null;
    last_retry_at: string | null;
  }>;

  if (rows.length === 0) return;

  const bumpToApproved = db.prepare(`
    UPDATE auto_listings
       SET status = 'approved',
           retry_count = retry_count + 1,
           last_retry_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ?
  `);
  const archive = db.prepare(`
    UPDATE auto_listings
       SET status = 'archived',
           last_retry_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ?
  `);

  for (const r of rows) {
    const isTerminal = TERMINAL_PATTERNS.some(p => p.test(r.last_error ?? ''));
    if (isTerminal) {
      log.info('Listing failure is terminal — skipping retry', { id: r.id, error: r.last_error });
      // Don't archive automatically; user might fix the photos/address.
      continue;
    }

    // Backoff check: each retry waits longer.
    const requiredHoursAgo = backoffHours(r.retry_count);
    if (r.last_retry_at) {
      const ageH = (Date.now() - new Date(r.last_retry_at).getTime()) / 3_600_000;
      if (ageH < requiredHoursAgo) continue;
    }

    if (r.retry_count + 1 >= MAX_RETRIES) {
      // Last attempt scheduled. After this run, if it fails again, archive.
      log.info('Final retry attempt', { id: r.id, folder: r.folder_num, retryCount: r.retry_count + 1 });
    }
    bumpToApproved.run(r.id);
    log.info('Retry queued', { id: r.id, folder: r.folder_num, retry: r.retry_count + 1 });
  }

  // Archive listings that have exceeded MAX_RETRIES and are still failed.
  const stuck = db.prepare(`
    SELECT id, title, folder_num, retry_count, last_error
      FROM auto_listings
     WHERE status = 'failed'
       AND retry_count >= ?
       AND last_retry_at < datetime('now', '-24 hours')
     LIMIT 10
  `).all(MAX_RETRIES) as Array<{ id: number; title: string; folder_num: number; retry_count: number; last_error: string | null }>;

  for (const s of stuck) {
    archive.run(s.id);
    log.warn('Listing exceeded max retries — archived', { id: s.id, folder: s.folder_num, retries: s.retry_count });
    eventBus.publish({
      type: 'alert',
      level: 'error',
      message: `📦 Listing "${s.title}" nach ${s.retry_count} Versuchen archiviert. Letzter Fehler: ${s.last_error ?? '?'}`,
    });
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('failed-retrier-tick', 300, async () => tickInner());
}

export function startFailedListingRetrier(): void {
  if (timer) return;
  log.info('Failed-listings-retrier started', { intervalMs: INTERVAL_MS, maxRetries: MAX_RETRIES });
  setTimeout(() => void tick(), 5 * 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopFailedListingRetrier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Failed-listings-retrier stopped');
  }
}

export const _internal = { tickInner, backoffHours };
