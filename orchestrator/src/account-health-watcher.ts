// ──────────────────────────────────────────────────────────────────────────────
// Account-Health-Watcher
//
// Reads recent events from `account_health_events`, recomputes the cached
// `health_status` per account, and auto-pauses accounts whose pattern is bad
// enough (3+ CAPTCHAs in 6h, 5+ session-losses in 24h, single proxy-down …).
//
// Why not in-process? Auto-pause has to survive a single noisy worker tick —
// we'd rather see the pattern build up across many ticks. Keeping the
// decision in its own periodic worker also means the dashboard / a
// telegram-alert can react centrally instead of every bot duplicating it.
//
// Iterates over ALL accounts (active + inactive) because a paused account
// can still benefit from a recomputed status, and because we want to expose
// a "ready for manual review" event 6h after the last critical event.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  isPaused,
  withLock,
  listAccounts,
  pauseAccount,
  recomputeHealthStatus,
  shouldAutoPause,
  type VintedAccount,
} from '@vinted-system/shared';
import { eventBus } from './events.js';
import { sendTelegram } from './telegram-alerts.js';

const log = createLogger('account-health-watcher');

const INTERVAL_MS = 5 * 60 * 1000;
const REVIEW_READY_AFTER_H = 6;
let timer: ReturnType<typeof setInterval> | null = null;

async function processAccount(acc: VintedAccount): Promise<void> {
  // 1. Refresh the cached status pill on the row so the dashboard reflects
  //    recent activity regardless of whether we end up pausing.
  const nextStatus = recomputeHealthStatus(acc.id);

  // 2. If already paused, see if enough time has passed since the last
  //    critical event to fire a one-time "ready for manual review" hint.
  //    We don't auto-unpause — that's a human decision (the underlying
  //    cause might still be there, e.g. burnt proxy IP).
  if (nextStatus === 'paused') {
    await emitReviewReadyIfDue(acc);
    return;
  }

  // 3. Active or warning account — check whether the recent pattern is
  //    bad enough to pause.
  const decision = shouldAutoPause(acc.id);
  if (!decision.pause) return;

  const reason = decision.reason ?? 'Account-Pattern auffällig';
  log.warn('Auto-pausing account', {
    accountId: acc.id,
    label: acc.label,
    marketplace: acc.marketplace ?? 'vinted',
    reason,
  });
  pauseAccount(acc.id, reason);

  // Surface the pause via SSE so the dashboard banner reacts in real-time.
  eventBus.publish({
    type: 'alert',
    level: 'error',
    message: `Account #${acc.id} (${acc.label}) auto-pausiert: ${reason}`,
  });
  // Telegram-push so the operator hears about it even off-dashboard.
  void sendTelegram(
    `🚨 Account #${acc.id} (${acc.label}) auto-pausiert\nGrund: ${reason}`,
  );
}

/** Once per pause-cycle, after the configured cool-down (default 6h since
 *  the last critical event), emit a "ready for manual review" event. We
 *  guard against spam by stashing a marker in the settings table per
 *  account so the same paused account doesn't ping the operator twice. */
async function emitReviewReadyIfDue(acc: VintedAccount): Promise<void> {
  const db = getDb();
  const last = db
    .prepare(
      `SELECT created_at FROM account_health_events
        WHERE account_id = ?
          AND severity IN ('error','critical')
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(acc.id) as { created_at: string } | undefined;
  if (!last) return;

  // SQLite stores UTC naïvely; reparse with Z so JS handles the offset.
  const lastTs = new Date(`${last.created_at.replace(' ', 'T')}Z`).getTime();
  const hoursSince = (Date.now() - lastTs) / 3_600_000;
  if (hoursSince < REVIEW_READY_AFTER_H) return;

  const markerKey = `_account_review_ready_${acc.id}_${last.created_at}`;
  const already = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(markerKey) as { value: string } | undefined;
  if (already) return;

  log.info('Account paused long enough for manual review', { accountId: acc.id });
  db.prepare(
    `INSERT INTO settings(key, value) VALUES(?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(markerKey);

  eventBus.publish({
    type: 'alert',
    level: 'warn',
    message: `Account #${acc.id} (${acc.label}) ist seit ${REVIEW_READY_AFTER_H}h pausiert — bitte prüfen.`,
  });
}

async function tickInner(): Promise<void> {
  const accounts = listAccounts();
  for (const acc of accounts) {
    try {
      await processAccount(acc);
    } catch (err) {
      log.warn('processAccount failed', {
        accountId: acc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('account-health-watcher', 120, tickInner);
}

export function startAccountHealthWatcher(): void {
  if (timer) return;
  log.info('Account-health-watcher started', { intervalMs: INTERVAL_MS });
  // First tick 60s after start so the orchestrator has a moment to finish
  // booting the other workers before we start writing to the DB.
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopAccountHealthWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Account-health-watcher stopped');
  }
}
