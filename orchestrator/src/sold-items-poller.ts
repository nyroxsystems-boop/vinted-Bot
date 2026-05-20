// ──────────────────────────────────────────────────────────────────────────────
// Sold-Items-Poller
//
// Hits vinted-bot /scan/sold-items every 30 minutes per active account.
// This catches Direct-Buy sales (where buyer clicks "Sofort kaufen" without
// any offer) that the offer-accept flow never sees.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, isPaused, listActiveAccounts, withLock } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('sold-items-poller');

let timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 30 * 60 * 1000;
const VINTED = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

async function pollAccount(accountId: number): Promise<void> {
  try {
    const res = await fetch(`${VINTED}/scan/sold-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json() as {
      ok: boolean;
      result?: { inserted: number; updated: number; scanned: number; warnings: string[] };
      error?: string;
    };
    if (!body.ok) {
      log.warn('scan failed', { accountId, error: body.error });
      return;
    }
    const r = body.result;
    if (!r) return;
    if (r.inserted > 0 || r.warnings.length > 0) {
      log.info('Sold-items scan', { accountId, ...r });
    }
    if (r.inserted > 0) {
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `🛒 ${r.inserted} neue Direct-Buy Sales auf Vinted entdeckt (Account ${accountId}).`,
      });
    }
    if (r.warnings.length > 0) {
      // Throttle: only alert once per day if scan returns warnings.
      const key = `sold_scan_warn_${accountId}`;
      const lastWarn = (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
      const ageH = lastWarn ? (Date.now() - new Date(lastWarn).getTime()) / 3_600_000 : 999;
      if (ageH > 24) {
        getDb().prepare(`
          INSERT INTO settings(key, value) VALUES (?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key);
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `⚠️ Sold-items scan returned warnings (Account ${accountId}): ${r.warnings[0]} — Vinted DOM hat sich evtl. geändert, selectors prüfen.`,
        });
      }
    }
  } catch (err) {
    log.warn('scan call failed', { accountId, error: err instanceof Error ? err.message : String(err) });
  }
}

async function tick(): Promise<void> {
  if (isPaused()) return;
  await withLock('sold-items-poller-tick', 300, async () => {
    const accounts = listActiveAccounts();
    for (const acc of accounts) {
      await pollAccount(acc.id);
    }
  });
}

export function startSoldItemsPoller(): void {
  if (timer) return;
  log.info('Sold-items-poller started', { intervalMs: INTERVAL_MS, target: VINTED });
  // First poll 3 minutes after boot — gives vinted-bot time to come up.
  setTimeout(() => void tick(), 3 * 60_000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

export function stopSoldItemsPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Sold-items-poller stopped');
  }
}
