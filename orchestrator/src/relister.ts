// ──────────────────────────────────────────────────────────────────────────────
// Re-Lister Worker
//
// CJ Dropshipping has effectively infinite stock per variant, so after a sale
// goes through Vinted we want to immediately put up a fresh listing of the
// same item. This worker does two things per tick:
//
//   1. DETECT — find paid sales whose auto_listings row hasn't been stamped
//      with sold_at yet, stamp it (via inventory_locks for cross-platform).
//
//   2. RELIST — find folders that have been sold for ≥ relist_delay_hours and
//      have no active listing left, clone the original auto_listings row as
//      a fresh `status='approved'` draft. The Auto-Publisher then picks it
//      up on its next cycle (1 listing / min, capped at vinted_daily_publish_cap).
//
// Daily cap (`relist_max_per_day`) prevents bursts: the worker queues at most
// N re-lists per rolling 24h. Inactive folders (no sale in
// relist_inactive_pause_days) are skipped.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  isPaused,
  lockSold,
  withLock,
  type MarketplaceId,
} from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('relister');

// One-shot schema migration for re-list supersede tracking. The shared
// ensureColumn helper is internal to db.ts, so we do the column adds inline
// with try/catch — ALTER TABLE ADD COLUMN is a no-op once the column exists,
// but SQLite throws a "duplicate column" error so we swallow it.
let supersedeColsEnsured = false;
function ensureSupersedeColumns(): void {
  if (supersedeColsEnsured) return;
  const db = getDb();
  const tryAdd = (table: string, col: string, defSQL: string): void => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSQL}`);
      log.info('Added column', { table, col });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "duplicate column name" is fine — column already exists.
      if (!/duplicate column/i.test(msg)) {
        log.debug('ensure-column skipped', { table, col, err: msg });
      }
    }
  };
  tryAdd('marketplace_listings', 'superseded_at', 'TEXT');
  tryAdd('marketplace_listings', 'superseded_by', 'INTEGER');
  tryAdd('auto_listings', 'relist_supersedes_id', 'INTEGER');
  supersedeColsEnsured = true;
}

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min — daily cap is enforced per-tick

// Soft per-tick cap so a burst of sales doesn't dump 30 re-lists at once.
// With 48 ticks/day this caps at 96/day, but the daily-cap setting overrides.
const MAX_RELISTS_PER_TICK = 2;

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  if (getSetting('relist_enabled') !== 'true') return;
  isRunning = true;
  try {
    await withLock('relister-tick', 600, async () => {
      detectAndStampSales();
      await scheduleRelists();
    });
  } catch (err) {
    log.error('Re-Lister tick crashed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

// ── 1. Stamp sold_at on auto_listings when a sale comes in ──────────────────
function detectAndStampSales(): void {
  const db = getDb();
  // Multi-marketplace: resolve folder via marketplace_listings (unique on
  // external_id). Pick the OLDEST unsold published auto_listing for that
  // folder — that's the one that was actually live when the sale happened.
  const rows = db.prepare(`
    SELECT s.id           AS sale_id,
           s.paid_at,
           s.marketplace,
           s.listing_id,
           l.list_price_eur,
           (SELECT al.id FROM auto_listings al
             WHERE al.folder_num = ml.folder_num
               AND al.status IN ('published','publishing')
               AND al.sold_at IS NULL
             ORDER BY al.created_at ASC LIMIT 1) AS auto_listing_id,
           ml.folder_num
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      JOIN marketplace_listings ml
        ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
       AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
     WHERE s.paid_at IS NOT NULL
       AND (SELECT al.id FROM auto_listings al
             WHERE al.folder_num = ml.folder_num
               AND al.status IN ('published','publishing')
               AND al.sold_at IS NULL
             LIMIT 1) IS NOT NULL
     ORDER BY s.paid_at ASC
  `).all() as Array<{
    sale_id: number;
    paid_at: string;
    marketplace: string | null;
    listing_id: number;
    list_price_eur: number;
    auto_listing_id: number;
    folder_num: number;
  }>;

  if (rows.length === 0) return;
  log.info(`Stamping ${rows.length} new sales`);

  const stamp = db.prepare(`
    UPDATE auto_listings
       SET sold_at = ?, last_sold_at = ?, updated_at = datetime('now')
     WHERE id = ?
  `);
  const markListing = db.prepare(`UPDATE listings SET status = 'sold', sold_at = ? WHERE id = ?`);

  for (const r of rows) {
    try {
      stamp.run(r.paid_at, r.paid_at, r.auto_listing_id);
      markListing.run(r.paid_at, r.listing_id);
      // Cross-platform inventory-lock (best-effort; idempotent).
      try {
        lockSold(
          r.folder_num,
          (r.marketplace ?? 'vinted') as MarketplaceId,
          r.list_price_eur,
          `sale:${r.sale_id}`,
        );
      } catch (err) {
        log.warn('lockSold failed', { folderNum: r.folder_num, error: err instanceof Error ? err.message : String(err) });
      }
      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `🛒 Sale #${r.sale_id} stamped — Folder #${r.folder_num} ist verkauft.`,
      });
    } catch (err) {
      log.error('Stamping sale failed', {
        saleId: r.sale_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Anti-duplicate variation helpers ────────────────────────────────────────
// Vinted detects identical re-listings (same title + same photos + same price)
// as spam and can flag the account. We add small, plausible variations on
// each re-list so the listing looks freshly created.

function shufflePhotos(json: string | null | undefined): string {
  if (!json) return '[]';
  let arr: string[];
  try { arr = JSON.parse(json) as string[]; } catch { return json; }
  if (!Array.isArray(arr) || arr.length < 2) return json;
  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as string, arr[i] as string];
  }
  return JSON.stringify(arr);
}

// User preference: NO emojis or special chars in titles. We still need a bit
// of variation to dodge Vinted's duplicate-listing detection, so we vary the
// SUFFIX only with neutral German add-ons (no emoji, no |, no *).
const TITLE_SUFFIXES = ['', ' Neu', ' Top', ' Schön', ' Sommer', ' Trend', ' Casual'];
const STRIP_RE = /[\p{Extended_Pictographic}️|*&✨]/gu;

function jitterTitle(title: string): string {
  // Strip emojis + bad punctuation that snuck in from older variants
  let core = title.replace(STRIP_RE, '').replace(/\s{2,}/g, ' ').trim();
  // Strip any suffix we added previously
  for (const s of TITLE_SUFFIXES) if (s && core.endsWith(s)) { core = core.slice(0, -s.length).trim(); break; }
  const suf = TITLE_SUFFIXES[Math.floor(Math.random() * TITLE_SUFFIXES.length)] ?? '';
  const out = `${core}${suf}`.trim();
  return out.length > 80 ? out.slice(0, 80) : out;
}

function jitterPrice(priceEur: number): number {
  // FIX 7: Prozentual statt absolut. ±0.50 € verteilt sich für 5-€-Listings
  // anders als für 35-€-Listings — Vinted's Dup-Check freut sich über
  // konsistente Skalierung. Variance bleibt im 5–8 %-Band, snap auf 0.50 €.
  const pctVariance = 0.05 + Math.random() * 0.03; // 5–8 %
  const sign = Math.random() < 0.5 ? -1 : 1;
  const delta = priceEur * pctVariance * sign;
  const next = Math.max(1, priceEur + delta);
  // Auf 0.50 € runden so dass die Preise weiterhin "natürlich" aussehen.
  return Math.round(next * 2) / 2;
}

// ── 2. Find sold folders ready for re-listing, queue clones ─────────────────
async function scheduleRelists(): Promise<void> {
  const db = getDb();
  ensureSupersedeColumns();
  const delayH = Number(getSetting('relist_delay_hours') ?? '24');
  const maxPerDay = Number(getSetting('relist_max_per_day') ?? '30');
  const pauseDays = Number(getSetting('relist_inactive_pause_days') ?? '21');

  // How many re-lists in the last rolling 24h?
  const recent = db.prepare(`
    SELECT COUNT(*) AS cnt FROM auto_listings
     WHERE parent_folder_num IS NOT NULL
       AND created_at > datetime('now', '-24 hours')
  `).get() as { cnt: number };

  const budget = maxPerDay - recent.cnt;
  if (budget <= 0) {
    log.debug(`Daily relist cap reached (${recent.cnt}/${maxPerDay})`);
    return;
  }

  // Candidates: sold ≥ delayH ago, last_sold_at within pause window, and no
  // currently-active sibling clone (status in approved/publishing/published
  // and not yet sold).
  const candidates = db.prepare(`
    SELECT al.id          AS source_id,
           al.folder_num,
           al.title,
           al.description,
           al.category,
           al.subcategory,
           al.brand,
           al.size,
           al.condition,
           al.color,
           al.material,
           al.price_eur,
           al.temu_price_eur,
           al.profit_margin_eur,
           al.shipping_method,
           al.photo_paths_json,
           al.temu_url,
           al.cj_product_url,
           al.cj_cost_eur,
           al.cj_product_id,
           al.cj_variant_id,
           al.account_id,
           al.relist_count,
           al.sold_at,
           al.target_marketplaces
      FROM auto_listings al
     WHERE al.sold_at IS NOT NULL
       AND al.sold_at < datetime('now', '-${delayH} hours')
       AND (al.last_sold_at IS NULL OR al.last_sold_at > datetime('now', '-${pauseDays} days'))
       AND NOT EXISTS (
         SELECT 1 FROM auto_listings sib
          WHERE sib.folder_num = al.folder_num
            AND sib.id != al.id
            AND sib.sold_at IS NULL
            AND sib.status IN ('draft','approved','publishing','published')
       )
     ORDER BY al.sold_at ASC
     LIMIT ?
  `).all(Math.min(budget, MAX_RELISTS_PER_TICK)) as Array<Record<string, unknown>>;

  if (candidates.length === 0) return;
  log.info(`Re-listing ${candidates.length} folders (budget ${budget}/${maxPerDay})`);

  // C6 — target_marketplaces is carried forward from parent → clone so the
  // auto-publisher re-crosslists to the same set of marketplaces on the
  // next tick. Without this, KA/Depop/eBay listings stay 'sold' forever
  // (auto-publisher only sees the Vinted-master crosslist toggle and
  // would fall back to global settings which may not match user intent).
  const insertClone = db.prepare(`
    INSERT INTO auto_listings (
      account_id, folder_num, crawled_product_id, title, description,
      category, subcategory, brand, size, condition, color, material,
      price_eur, temu_price_eur, profit_margin_eur,
      shipping_method, photo_paths_json,
      temu_url, cj_product_url, cj_cost_eur, cj_product_id, cj_variant_id,
      status, parent_folder_num, relist_count, last_sold_at,
      relist_supersedes_id, target_marketplaces
    ) VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,?)
    RETURNING id
  `);

  // Prepared statements for the supersede side of the transaction.
  // We mark the OLD parent auto_listings row as 'superseded' so the
  // Auto-Publisher does not pick it up again, and we flag the corresponding
  // marketplace_listings row as superseded so the Vinted-bot's delete-worker
  // can clean it up (avoids two live listings on Vinted = duplicate-spam flag).
  const markParentAutoSuperseded = db.prepare(`
    UPDATE auto_listings
       SET status = 'superseded', updated_at = datetime('now')
     WHERE id = ?
  `);
  const markMarketplaceSuperseded = db.prepare(`
    UPDATE marketplace_listings
       SET status = 'pending_delete',
           superseded_at = datetime('now'),
           superseded_by = ?
     WHERE folder_num = ?
       AND status IN ('published','active','live')
  `);

  for (const c of candidates) {
    try {
      // Anti-duplicate variations: Vinted detects exact re-listings via
      // photo hash + title + price. We change small things to look like
      // a fresh listing without altering substance.
      const photos = shufflePhotos(c.photo_paths_json as string);
      const newTitle = jitterTitle(c.title as string);
      const newPrice = jitterPrice(c.price_eur as number);

      // FIX 1: Wrap supersede + clone-insert in a SQLite transaction so we
      // either commit BOTH (old marked superseded + new clone inserted) or
      // NEITHER. Without this, a partial failure would leave two live
      // listings on Vinted → duplicate-spam flag.
      const txn = db.transaction(() => {
        // 1) Mark the parent auto_listing as superseded so Auto-Publisher
        //    will never re-publish it.
        markParentAutoSuperseded.run(c.source_id);

        // 2) Insert the fresh clone.
        const cloneId = (insertClone.get(
          c.account_id, c.folder_num,
          newTitle, c.description,
          c.category, c.subcategory, c.brand, c.size, c.condition, c.color, c.material,
          newPrice, c.temu_price_eur, c.profit_margin_eur,
          c.shipping_method, photos,
          c.temu_url, c.cj_product_url, c.cj_cost_eur, c.cj_product_id, c.cj_variant_id,
          c.folder_num,                       // parent_folder_num
          (Number(c.relist_count) || 0) + 1,  // relist_count incremented
          c.sold_at,                          // last_sold_at carries forward
          c.source_id,                        // relist_supersedes_id
          c.target_marketplaces ?? null,      // C6: carry crosslist intent
        ) as { id: number }).id;

        // 3) Flag any still-live marketplace_listings for this folder as
        //    pending_delete + record the superseding clone id. The Vinted-bot
        //    delete-worker will pick these up to actually remove them from
        //    the platform.
        try {
          markMarketplaceSuperseded.run(cloneId, c.folder_num);
        } catch (mlErr) {
          // Older DBs might not have the supersede columns yet, or the
          // 'pending_delete' status may not be allowed by an enum-check.
          // Fall back to status-less marking — we still have
          // auto_listings.status='superseded' as the publisher-side guard.
          log.debug('marketplace_listings supersede mark failed (non-fatal)', {
            folder: c.folder_num,
            err: mlErr instanceof Error ? mlErr.message : String(mlErr),
          });
        }

        return cloneId;
      });

      const newId = txn();

      log.info('Re-listed folder', {
        folder: c.folder_num,
        source: c.source_id,
        clone: newId,
        relistCount: (Number(c.relist_count) || 0) + 1,
      });

      // C6 — Find existing 'sold' or 'deactivated' cross-marketplace listings
      // for this folder. Since KA/Depop/eBay bots don't have a re-activate
      // endpoint (only `/api/listings/publish`), the auto-publisher will
      // create FRESH listings using the clone's `target_marketplaces`. The
      // old sold rows stay as history (different external_id won't conflict
      // with the new ones thanks to the partial unique index on external_id).
      const dormantCrosslists = db.prepare(`
        SELECT marketplace, external_id, status
          FROM marketplace_listings
         WHERE folder_num = ?
           AND account_id = ?
           AND marketplace != 'vinted'
           AND status IN ('sold','deactivated','pending_delete')
      `).all(c.folder_num, c.account_id) as Array<{ marketplace: string; external_id: string; status: string }>;

      if (dormantCrosslists.length > 0) {
        const mps = dormantCrosslists.map((r) => r.marketplace).join(', ');
        log.info('Cross-marketplace re-activation queued via auto-publisher', {
          folder: c.folder_num,
          clone: newId,
          marketplaces: mps,
        });
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `🔁 Folder #${c.folder_num}: ${dormantCrosslists.length} Cross-Listings (${mps}) werden neu gelistet via Auto-Publisher.`,
        });
      }

      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `🔄 Folder #${c.folder_num} neu gelistet (Klon #${newId}). Auto-Publisher schickt es in <60s an Vinted.`,
      });
    } catch (err) {
      log.error('Re-list clone failed', {
        folder: c.folder_num,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startRelister(): void {
  if (timer) return;
  log.info('Re-Lister worker started', {
    intervalMs: POLL_INTERVAL_MS,
    delayH: getSetting('relist_delay_hours') ?? '24',
    maxPerDay: getSetting('relist_max_per_day') ?? '30',
  });
  // First tick after 90s so other workers + bots are up
  setTimeout(() => void tick(), 90_000);
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopRelister(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Re-Lister worker stopped');
  }
}

// Exported for tests
export const _internal = { tick, detectAndStampSales, scheduleRelists };
