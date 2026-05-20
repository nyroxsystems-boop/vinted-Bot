// ──────────────────────────────────────────────────────────────────────────────
// Auto-Repricing Worker
//
// Algorithmus:
//   1. Sammle alle aktiven marketplace_listings
//   2. Für jedes:
//      - Min-Alter: created_at <= now - idle_days
//      - 0 Messages, 0 Likes ODER (Likes > 0 aber 0 Messages und letzte 7d
//        keine Bewegung in listing_metrics)
//      - Drops bisher < repricing_max_drops
//   3. Berechne new_price = list_price × (1 - drop_pct/100)
//   4. Floor = max(temu_price × floor_markup, min_price_eur)
//   5. Wenn new_price < floor → outcome=skipped-floor, log
//   6. Sonst: rufe Plattform-Adapter.updatePrice() via HTTP, log Outcome
//
// Schreibt jeden Schritt nach `repricing_log` für Audit + Dashboard.
//
// Cadence: täglich. Kein gleichzeitiges Bedrohen mit Performance-Collector
// (der schreibt KPIs, dieser liest sie).
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  isSold,
  type MarketplaceId,
} from '@vinted-system/shared';
import { BOT_ENDPOINTS } from './marketplaces.js';

const log = createLogger('repricer');

interface CandidateRow {
  id: number;
  marketplace: MarketplaceId;
  account_id: number;
  folder_num: number;
  external_id: string | null;
  external_url: string | null;
  list_price_eur: number;
  views: number;
  likes: number;
  messages: number;
  created_at: string;
  drops: number;        // count from repricing_log
  temu_price_eur: number;
}

interface HotSellerRow {
  id: number;
  marketplace: MarketplaceId;
  account_id: number;
  folder_num: number;
  external_id: string | null;
  external_url: string | null;
  list_price_eur: number;
  views: number;
  likes: number;
  messages: number;
  offers_recent: number;       // # offers in last 48h
  messages_recent: number;     // # new messages in last 48h
  created_at: string;
  boost_count: number;         // applied boosts so far
  initial_list_price: number;  // first ever list price (for boost-ceiling)
}

export interface RepriceStats {
  evaluated: number;
  applied: number;
  skippedFloor: number;
  skippedNotImplemented: number;
  failed: number;
  hotBoostsApplied?: number;
  hotBoostsSkipped?: number;
}

function settingsSnapshot() {
  return {
    enabled: (getSetting('auto_repricing_enabled') ?? 'true') === 'true',
    idleDays: parseInt(getSetting('repricing_idle_days') ?? '7', 10),
    dropPct: parseFloat(getSetting('repricing_drop_pct') ?? '10'),
    floorMarkup: parseFloat(getSetting('repricing_floor_markup') ?? '1.5'),
    minPriceEur: parseFloat(getSetting('repricing_min_price_eur') ?? '5'),
    maxDrops: parseInt(getSetting('repricing_max_drops') ?? '3', 10),
    intervalHours: parseInt(getSetting('repricing_interval_hours') ?? '24', 10),
    // Hot-Seller-Boost: nudge the price UP when there's demand but no sale.
    // Bounded by initial list_price × ceilingMultiplier so we don't price
    // ourselves out — Vinted buyers anchor on the original price.
    hotBoostEnabled: (getSetting('repricing_hot_boost_enabled') ?? 'true') === 'true',
    hotBoostPct: parseFloat(getSetting('repricing_hot_boost_pct') ?? '7'),  // 5–10% range
    hotBoostCeilingMultiplier: parseFloat(getSetting('repricing_hot_boost_ceiling') ?? '1.3'),
    hotBoostMinMessages: parseInt(getSetting('repricing_hot_min_messages') ?? '5', 10),
    hotBoostMinOffers: parseInt(getSetting('repricing_hot_min_offers') ?? '3', 10),
    hotBoostWindowHours: parseInt(getSetting('repricing_hot_window_hours') ?? '48', 10),
    // Likes-no-messages drop: 14d window, 10+ likes, 0 messages → drop 8%
    likesDropPct: parseFloat(getSetting('repricing_likes_drop_pct') ?? '8'),
    likesNoMsgsMinLikes: parseInt(getSetting('repricing_likes_min_likes') ?? '10', 10),
    likesNoMsgsWindowDays: parseInt(getSetting('repricing_likes_window_days') ?? '14', 10),
  };
}

function loadCandidates(idleDays: number, maxDrops: number): CandidateRow[] {
  return getDb()
    .prepare(
      `SELECT
         ml.id, ml.marketplace, ml.account_id, ml.folder_num,
         ml.external_id, ml.external_url, ml.list_price_eur,
         ml.views, ml.likes, ml.messages, ml.created_at,
         (SELECT COUNT(*) FROM repricing_log rl
            WHERE rl.marketplace_listing_id = ml.id
              AND rl.outcome = 'applied') AS drops,
         COALESCE(al.temu_price_eur, 0) AS temu_price_eur
       FROM marketplace_listings ml
       LEFT JOIN auto_listings al ON al.folder_num = ml.folder_num
       WHERE ml.status = 'active'
         AND ml.created_at <= datetime('now', '-' || ? || ' days')
         AND COALESCE(ml.messages, 0) = 0
       GROUP BY ml.id
       HAVING drops < ?
       ORDER BY ml.created_at ASC`,
    )
    .all(idleDays, maxDrops) as CandidateRow[];
}

/** Listings with high demand but no sale yet — candidates for a PRICE BOOST.
 *  Selection: ≥ minMessages OR ≥ minOffers in the last windowHours,
 *  current price below initial × ceilingMultiplier (so we don't keep
 *  bumping indefinitely). */
function loadHotSellers(opts: {
  minMessages: number;
  minOffers: number;
  windowHours: number;
  ceilingMultiplier: number;
}): HotSellerRow[] {
  // listing_metrics row from windowHours ago — we'll diff "current" totals
  // against the oldest in-window snapshot to count "recent" messages.
  const raw = getDb()
    .prepare(
      `SELECT
         ml.id, ml.marketplace, ml.account_id, ml.folder_num,
         ml.external_id, ml.external_url, ml.list_price_eur,
         ml.views, ml.likes, ml.messages,
         ml.messages -
           COALESCE((SELECT messages FROM listing_metrics lm
                      WHERE lm.marketplace_listing_id = ml.id
                        AND lm.recorded_at <= datetime('now', '-' || ? || ' hours')
                      ORDER BY lm.recorded_at DESC LIMIT 1), 0) AS messages_recent,
         (SELECT COUNT(*) FROM offers o
            JOIN listings l ON l.id = o.listing_id
           WHERE l.vinted_item_id = ml.external_id
             AND o.created_at > datetime('now', '-' || ? || ' hours')) AS offers_recent,
         ml.created_at,
         (SELECT COUNT(*) FROM repricing_log rl
            WHERE rl.marketplace_listing_id = ml.id
              AND rl.outcome = 'applied'
              AND rl.reason = 'hot-seller-boost') AS boost_count,
         (SELECT old_price_eur FROM repricing_log rl
            WHERE rl.marketplace_listing_id = ml.id
            ORDER BY rl.created_at ASC LIMIT 1) AS initial_price
       FROM marketplace_listings ml
       WHERE ml.status = 'active'
         AND COALESCE(ml.messages, 0) > 0
       ORDER BY ml.created_at ASC`,
    )
    .all(opts.windowHours, opts.windowHours) as Array<{
      id: number; marketplace: MarketplaceId; account_id: number;
      folder_num: number; external_id: string | null; external_url: string | null;
      list_price_eur: number; views: number; likes: number; messages: number;
      messages_recent: number | null; offers_recent: number | null;
      created_at: string; boost_count: number; initial_price: number | null;
    }>;

  return raw
    .map((r): HotSellerRow => ({
      id: r.id, marketplace: r.marketplace, account_id: r.account_id,
      folder_num: r.folder_num, external_id: r.external_id, external_url: r.external_url,
      list_price_eur: r.list_price_eur,
      views: r.views, likes: r.likes, messages: r.messages,
      messages_recent: r.messages_recent ?? 0,
      offers_recent: r.offers_recent ?? 0,
      created_at: r.created_at,
      boost_count: r.boost_count,
      initial_list_price: r.initial_price ?? r.list_price_eur,
    }))
    .filter(r =>
      (r.messages_recent >= opts.minMessages || r.offers_recent >= opts.minOffers)
      && r.list_price_eur < r.initial_list_price * opts.ceilingMultiplier,
    );
}

function computeFloor(temuPrice: number, markup: number, minPrice: number): number {
  return Math.max(temuPrice * markup, minPrice);
}

function reasonFor(row: CandidateRow): string {
  if (row.likes === 0 && row.views < 20) return 'idle-no-traction';
  if (row.likes > 0 && row.messages === 0) return 'likes-no-messages';
  return 'idle';
}

/** Likes-no-messages drop: the listing has visual pull (likes > minLikes) but
 *  zero conversations in the time-window. Buyers are watching the price, not
 *  the product — drop by likesDropPct to nudge them into messaging. */
function isLikesNoMessagesCandidate(
  row: CandidateRow,
  minLikes: number,
  windowDays: number,
): boolean {
  if ((row.likes ?? 0) < minLikes) return false;
  if ((row.messages ?? 0) > 0) return false;
  // Listing must be old enough that the 14d-window has data on it.
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const ageMs = Date.now() - created;
  return ageMs >= windowDays * 24 * 60 * 60 * 1000;
}

function logEntry(opts: {
  listing: CandidateRow;
  oldPrice: number;
  newPrice: number;
  pct: number;
  reason: string;
  outcome: 'pending' | 'applied' | 'failed' | 'skipped-floor' | 'skipped-not-implemented';
  error?: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO repricing_log
         (marketplace_listing_id, marketplace, folder_num,
          old_price_eur, new_price_eur, pct_change, reason, outcome, error, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.listing.id,
      opts.listing.marketplace,
      opts.listing.folder_num,
      opts.oldPrice,
      opts.newPrice,
      opts.pct,
      opts.reason,
      opts.outcome,
      opts.error ?? null,
      opts.outcome === 'applied' ? new Date().toISOString() : null,
    );
  return Number(result.lastInsertRowid);
}

async function applyPriceOnPlatform(
  listing: CandidateRow,
  newPrice: number,
): Promise<{ ok: boolean; error?: string; notImplemented?: boolean }> {
  const url = `${BOT_ENDPOINTS[listing.marketplace]}/api/listings/update-price`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: listing.account_id,
        external_id: listing.external_id ?? listing.external_url,
        new_price_eur: newPrice,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status === 404) return { ok: false, notImplemented: true, error: 'updatePrice endpoint missing' };
    const data = (await r.json()) as { ok: boolean; error?: string; newPriceEur?: number };
    if (!data.ok && /not implemented/i.test(data.error ?? '')) {
      return { ok: false, notImplemented: true, error: data.error };
    }
    return { ok: !!data.ok, error: data.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runRepriceCycle(): Promise<RepriceStats> {
  const stats: RepriceStats = {
    evaluated: 0, applied: 0, skippedFloor: 0,
    skippedNotImplemented: 0, failed: 0,
    hotBoostsApplied: 0, hotBoostsSkipped: 0,
  };
  const cfg = settingsSnapshot();
  if (!cfg.enabled) {
    log.info('Auto-Repricing disabled (settings.auto_repricing_enabled=false)');
    return stats;
  }

  const candidates = loadCandidates(cfg.idleDays, cfg.maxDrops);
  log.info('Repricer evaluating', {
    candidates: candidates.length,
    cfg,
  });

  for (const c of candidates) {
    stats.evaluated++;
    if (isSold(c.folder_num)) {
      // Skip — Inventory-Lock: schon woanders verkauft
      continue;
    }
    const oldPrice = c.list_price_eur;

    // Pick drop-pct based on signal: likes-no-messages gets the bigger drop
    // because "viewed but not sold" buyers anchor on the price, not the item.
    const isLikesNoMsg = isLikesNoMessagesCandidate(c, cfg.likesNoMsgsMinLikes, cfg.likesNoMsgsWindowDays);
    const dropPct = isLikesNoMsg ? cfg.likesDropPct : cfg.dropPct;
    const targetPrice = Math.round((oldPrice * (1 - dropPct / 100)) * 100) / 100;
    const floor = computeFloor(c.temu_price_eur, cfg.floorMarkup, cfg.minPriceEur);
    const reason = isLikesNoMsg ? 'likes-no-messages-14d' : reasonFor(c);

    if (targetPrice < floor) {
      logEntry({
        listing: c,
        oldPrice,
        newPrice: floor,
        pct: dropPct,
        reason,
        outcome: 'skipped-floor',
        error: `target ${targetPrice} < floor ${floor.toFixed(2)}`,
      });
      stats.skippedFloor++;
      continue;
    }

    // Apply via Plattform-Adapter
    const result = await applyPriceOnPlatform(c, targetPrice);
    if (result.notImplemented) {
      logEntry({
        listing: c,
        oldPrice,
        newPrice: targetPrice,
        pct: dropPct,
        reason,
        outcome: 'skipped-not-implemented',
        error: result.error,
      });
      stats.skippedNotImplemented++;
      continue;
    }
    if (!result.ok) {
      logEntry({
        listing: c,
        oldPrice,
        newPrice: targetPrice,
        pct: dropPct,
        reason,
        outcome: 'failed',
        error: result.error,
      });
      stats.failed++;
      continue;
    }

    // Update DB-Preis
    getDb()
      .prepare(
        `UPDATE marketplace_listings
            SET list_price_eur = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(targetPrice, c.id);

    logEntry({
      listing: c,
      oldPrice,
      newPrice: targetPrice,
      pct: dropPct,
      reason,
      outcome: 'applied',
    });
    stats.applied++;
  }

  // ── Hot-Seller-Boost ─────────────────────────────────────────────────────
  // Listings with demand (≥5 messages OR ≥3 offers in 48h) but no sale →
  // bump the price 5–10% so we capture the buyer-willing-to-pay band. Capped
  // by initial_price × 1.3 so we never overshoot anchor.
  if (cfg.hotBoostEnabled) {
    let hotSellers: HotSellerRow[] = [];
    try {
      hotSellers = loadHotSellers({
        minMessages: cfg.hotBoostMinMessages,
        minOffers: cfg.hotBoostMinOffers,
        windowHours: cfg.hotBoostWindowHours,
        ceilingMultiplier: cfg.hotBoostCeilingMultiplier,
      });
    } catch (e) {
      log.warn('Hot-Seller-Boost lookup failed', { err: e instanceof Error ? e.message : String(e) });
    }
    log.info('Hot-Seller-Boost evaluating', { hotSellers: hotSellers.length });

    for (const h of hotSellers) {
      if (isSold(h.folder_num)) continue;
      const oldPrice = h.list_price_eur;
      const ceiling = h.initial_list_price * cfg.hotBoostCeilingMultiplier;
      const proposed = Math.round((oldPrice * (1 + cfg.hotBoostPct / 100)) * 100) / 100;
      const newPrice = Math.min(proposed, Math.round(ceiling * 100) / 100);

      if (newPrice <= oldPrice) {
        // Already at ceiling — log + skip so we don't retry every cycle.
        logEntry({
          listing: h as unknown as CandidateRow,
          oldPrice,
          newPrice: oldPrice,
          pct: cfg.hotBoostPct,
          reason: 'hot-seller-boost-ceiling',
          outcome: 'skipped-floor',
          error: `at ceiling ${ceiling.toFixed(2)}`,
        });
        stats.hotBoostsSkipped = (stats.hotBoostsSkipped ?? 0) + 1;
        continue;
      }

      const candidateShape: CandidateRow = {
        id: h.id, marketplace: h.marketplace, account_id: h.account_id,
        folder_num: h.folder_num, external_id: h.external_id, external_url: h.external_url,
        list_price_eur: h.list_price_eur,
        views: h.views, likes: h.likes, messages: h.messages,
        created_at: h.created_at, drops: 0, temu_price_eur: 0,
      };
      const result = await applyPriceOnPlatform(candidateShape, newPrice);
      if (result.notImplemented) {
        logEntry({
          listing: candidateShape, oldPrice, newPrice,
          pct: cfg.hotBoostPct, reason: 'hot-seller-boost',
          outcome: 'skipped-not-implemented', error: result.error,
        });
        stats.hotBoostsSkipped = (stats.hotBoostsSkipped ?? 0) + 1;
        continue;
      }
      if (!result.ok) {
        logEntry({
          listing: candidateShape, oldPrice, newPrice,
          pct: cfg.hotBoostPct, reason: 'hot-seller-boost',
          outcome: 'failed', error: result.error,
        });
        stats.failed++;
        continue;
      }

      getDb()
        .prepare(
          `UPDATE marketplace_listings
              SET list_price_eur = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(newPrice, h.id);

      logEntry({
        listing: candidateShape, oldPrice, newPrice,
        pct: cfg.hotBoostPct, reason: 'hot-seller-boost',
        outcome: 'applied',
      });
      stats.hotBoostsApplied = (stats.hotBoostsApplied ?? 0) + 1;
      log.info('Hot-Seller-Boost applied', {
        listing: h.id, oldPrice, newPrice,
        messagesRecent: h.messages_recent, offersRecent: h.offers_recent,
      });
    }
  }

  log.info('Repricer cycle done', stats);
  return stats;
}

// ── Scheduler-Hook ──────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export function startRepricer(): void {
  if (timer) return;
  const cfg = settingsSnapshot();
  const ms = cfg.intervalHours * 60 * 60 * 1000;
  log.info(`Repricer scheduled every ${cfg.intervalHours}h`);
  // Erster Run nach 90s
  setTimeout(() => { void runRepriceCycle().catch((e) => log.error('first run', { err: String(e) })); }, 90_000);
  timer = setInterval(() => {
    void runRepriceCycle().catch((e) => log.error('scheduled run', { err: String(e) }));
  }, ms);
}

export function stopRepricer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Repricer stopped');
  }
}

// ── Helpers für Routes ──────────────────────────────────────────────────────

export function recentRepriceLog(limit = 50): unknown[] {
  return getDb()
    .prepare(
      `SELECT * FROM repricing_log ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function repriceLogForFolder(folderNum: number): unknown[] {
  return getDb()
    .prepare(
      `SELECT * FROM repricing_log
         WHERE folder_num = ?
        ORDER BY created_at DESC`,
    )
    .all(folderNum);
}
