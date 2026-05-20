// ──────────────────────────────────────────────────────────────────────────────
// Sales-Killer Worker (a.k.a. "dead-listing archiver")
//
// Folders that have been re-listed twice but never sold are dead weight. They
// consume Daily-Cap slots, clog the Re-Lister queue, and produce zero EUR.
//
// The Sales-Killer scans auto_listings every 24h and archives folders that
// match all of the following criteria (configurable via settings):
//   • status = 'published'
//   • relist_count >= sales_killer_min_relists          (default 2)
//   • last_sold_at IS NULL                              (never sold)
//   • created_at  < now - sales_killer_min_age_days     (default 14 days)
//
// For each match:
//   1. auto_listings.status = 'archived' + last_error annotated.
//   2. All marketplace_listings rows for this folder + account flipped to
//      'deactivated' so the cross-platform bots don't keep them live.
//   3. eventBus alert so the dashboard sees the cleanup.
//
// The worker uses `withLock('sales-killer-tick', …)` so concurrent
// orchestrator restarts can't double-archive.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  setSetting,
  isPaused,
  markWorkerAlive,
  withLock,
} from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('sales-killer');

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// 24h cadence. First tick fires 2 minutes after orchestrator boot so the rest
// of the pipeline has time to settle.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_TICK_MS = 2 * 60 * 1000;

/** Seed sales-killer settings on first start. INSERT OR IGNORE — won't clobber
 *  user-changed values. */
function ensureSettings(): void {
  if (getSetting('sales_killer_enabled') === null) setSetting('sales_killer_enabled', 'true');
  if (getSetting('sales_killer_min_age_days') === null) setSetting('sales_killer_min_age_days', '14');
  if (getSetting('sales_killer_min_relists') === null) setSetting('sales_killer_min_relists', '2');
}

interface DeadListing {
  id: number;
  account_id: number;
  folder_num: number;
  title: string;
  created_at: string;
  relist_count: number;
}

function findDeadListings(minAgeDays: number, minRelists: number): DeadListing[] {
  return getDb().prepare(`
    SELECT id, account_id, folder_num, title, created_at,
           COALESCE(relist_count, 0) AS relist_count
      FROM auto_listings
     WHERE status = 'published'
       AND COALESCE(relist_count, 0) >= ?
       AND last_sold_at IS NULL
       AND created_at < datetime('now', '-' || ? || ' days')
     ORDER BY created_at ASC
     LIMIT 500
  `).all(minRelists, minAgeDays) as DeadListing[];
}

function archiveOne(row: DeadListing): void {
  const db = getDb();
  const note = `Sales-killer: 14d+ ohne Sale, ${row.relist_count} Re-Lists ohne Erfolg`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE auto_listings
         SET status = 'archived',
             last_error = ?,
             updated_at = datetime('now')
       WHERE id = ?
    `).run(note, row.id);

    // Flip every still-live marketplace_listings for this (folder, account)
    // to 'deactivated' so cross-platform bots stop refreshing them. Status
    // 'pending_delete' would also work but is reserved for re-list flows.
    db.prepare(`
      UPDATE marketplace_listings
         SET status = 'deactivated',
             last_error = COALESCE(last_error, ?),
             updated_at = datetime('now')
       WHERE folder_num = ?
         AND account_id = ?
         AND status IN ('active','published','publishing','draft')
    `).run(note, row.folder_num, row.account_id);
  });
  tx();
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  ensureSettings();
  if (getSetting('sales_killer_enabled') !== 'true') {
    markWorkerAlive('sales-killer');
    return;
  }
  isRunning = true;
  try {
    await withLock('sales-killer-tick', 600, async () => {
      const minAgeDays = Math.max(1, Number(getSetting('sales_killer_min_age_days') ?? '14'));
      const minRelists = Math.max(0, Number(getSetting('sales_killer_min_relists') ?? '2'));

      const dead = findDeadListings(minAgeDays, minRelists);
      if (dead.length === 0) {
        log.info('Sales-killer tick — no dead listings');
        return;
      }

      log.info(`Sales-killer archiving ${dead.length} dead listings`, { minAgeDays, minRelists });

      let archived = 0;
      for (const row of dead) {
        try {
          archiveOne(row);
          archived++;
        } catch (err) {
          log.error('Sales-killer archive failed', {
            id: row.id,
            folder: row.folder_num,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (archived > 0) {
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📦 ${archived} tote Listings archiviert — Daily-Cap-Slots freigegeben für neue Folders`,
        });
      }
    });
  } catch (err) {
    log.error('Sales-killer tick crashed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

export function startSalesKiller(): void {
  if (timer) return;
  ensureSettings();
  log.info('Sales-killer worker started', {
    intervalH: POLL_INTERVAL_MS / 3_600_000,
    enabled: getSetting('sales_killer_enabled'),
    minAgeDays: getSetting('sales_killer_min_age_days'),
    minRelists: getSetting('sales_killer_min_relists'),
  });
  setTimeout(() => void tick(), FIRST_TICK_MS);
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopSalesKiller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Sales-killer worker stopped');
  }
}

// Exposed for tests / manual triggers.
export const _internal = { tick, findDeadListings, archiveOne };
