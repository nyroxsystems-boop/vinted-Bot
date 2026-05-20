// ──────────────────────────────────────────────────────────────────────────────
// CJ Fulfillment Worker
//
// Runs periodically in the Orchestrator and handles the full CJ lifecycle:
//
//   1. New sales without CJ orders → create CJ order via API
//   2. CJ orders in 'ordered' → poll for tracking number
//   3. CJ orders with tracking → upload tracking to selling platform
//   4. CJ orders 'shipping' → poll for delivery confirmation
//
// Safety guards:
//   - cj_auto_order must be 'true'
//   - fulfillment_provider must be 'cj'
//   - Per-order cost limit (cj_max_order_eur)
//   - Daily order cap (cj_max_daily_orders)
//   - System pause check
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  setSetting,
  isPaused,
  startBotRun,
  finishBotRun,
  withLock,
  validateBuyerAddress,
  classifyCarrier,
  classifyTracking,
  findEuHandoverInHistory,
  recordWorkerEvent,
} from '@vinted-system/shared';
import { eventBus } from './events.js';
import { BOT_ENDPOINTS } from './marketplaces.js';
import type { MarketplaceId } from '@vinted-system/shared';

const log = createLogger('cj-fulfillment');

// One-shot schema migration for the cj_stock_reserved_at soft-lock column.
// `ensureColumn` is internal to db.ts so we add inline with try/catch.
let cjReserveColEnsured = false;
function ensureCjStockReserveColumn(): void {
  if (cjReserveColEnsured) return;
  try {
    getDb().exec(`ALTER TABLE auto_listings ADD COLUMN cj_stock_reserved_at TEXT`);
    log.info('Added column auto_listings.cj_stock_reserved_at');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) {
      log.debug('ensure cj_stock_reserved_at column skipped', { err: msg });
    }
  }
  cjReserveColEnsured = true;
}

const CJ_SERVICE_URL = process.env.CJ_SERVICE_URL ?? 'http://localhost:4720';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Worker cadence: 30 min between ticks. The per-order cooldowns below decide
// what actually runs each tick — the worker itself is cheap, only the CJ
// API calls cost quota.
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const MAX_PER_CYCLE = 25;

// Per-order cooldowns (hours) — only re-poll an order this often. Keeps the
// CJ daily quota (default 1000 calls/day) usable for actual order placements.
const TRACKING_POLL_COOLDOWN_H = 6;   // tracking number arrives 6–24h after order
const DELIVERY_POLL_COOLDOWN_H = 24;  // delivery status changes at most 1×/day
const STUCK_ORDER_THRESHOLD_H = 48;   // alert if 'ordered' > 48h without tracking

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  if (getSetting('fulfillment_provider') !== 'cj') return;
  if (getSetting('cj_auto_order') !== 'true') return;
  isRunning = true;
  try {
    // DB lock guards against parallel orchestrator instances (e.g. pm2 restart race).
    await withLock('cj-fulfillment-tick', 600, async () => {
      await processNewSales();
      await pollTrackingUpdates();
      await uploadTrackingToMarketplaces();
      await pollDeliveryConfirmation();
    });
  } catch (err) {
    log.error('CJ fulfillment worker crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

// ── Safety: Check daily order limit ──────────────────────────────────────────
function getDailyOrderCount(): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM cj_orders
    WHERE ordered_at > datetime('now', '-24 hours')
  `).get() as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

// ── 1. Auto-order: paid sales without CJ order → create order ────────────────
async function processNewSales(): Promise<void> {
  const db = getDb();
  ensureCjStockReserveColumn();
  const maxDaily = Number(getSetting('cj_max_daily_orders') ?? '50');
  const maxOrderEur = Number(getSetting('cj_max_order_eur') ?? '30');
  const dailyCount = getDailyOrderCount();

  if (dailyCount >= maxDaily) {
    // FIX 2: Statt silent skip — schreibe für JEDE übersprungene Sale eine
    // 'quota_exhausted'-Zeile in cj_orders. Beim nächsten Tick (mit
    // frischer Quota) werden die als 'quota_exhausted' markierten Rows
    // zuerst gepicked, ältester zuerst.
    const pending = db.prepare(`
      SELECT s.id AS sale_id
        FROM sales s
        JOIN listings l ON l.id = s.listing_id
        JOIN marketplace_listings ml
          ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
         AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
        JOIN cj_products cp ON cp.folder_num = ml.folder_num
       WHERE s.paid_at IS NOT NULL
         AND s.id NOT IN (SELECT sale_id FROM cj_orders)
       ORDER BY s.paid_at ASC
       LIMIT 50
    `).all() as Array<{ sale_id: number }>;
    const errMsg = `Daily quota ${maxDaily} reached at ${new Date().toISOString()}`;
    const stamp = db.prepare(`
      INSERT OR IGNORE INTO cj_orders (sale_id, status, error, created_at, updated_at)
      VALUES (?, 'quota_exhausted', ?, datetime('now'), datetime('now'))
    `);
    for (const p of pending) stamp.run(p.sale_id, errMsg);
    log.warn(`Daily CJ order limit reached (${dailyCount}/${maxDaily}) — ${pending.length} sales marked quota_exhausted`);
    try {
      recordWorkerEvent('cj-fulfillment', 'warn', 'quota_exhausted', {
        count: pending.length,
        daily_limit: maxDaily,
        daily_count: dailyCount,
      });
    } catch { /* telemetry is best-effort */ }
    return;
  }

  // FIX 3: CJ balance pre-flight — falls Saldo unter Schwelle, alle Orders
  // skippen statt sie mit cryptic "Insufficient balance"-Error in CJ failen
  // zu lassen.
  const minBalance = Number(getSetting('cj_min_balance_eur') ?? '5');
  try {
    const balRes = await fetch(`${CJ_SERVICE_URL}/api/balance`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (balRes.ok) {
      const balJson = await balRes.json() as { ok: boolean; balance_eur?: number };
      if (balJson.ok && typeof balJson.balance_eur === 'number') {
        if (balJson.balance_eur < minBalance) {
          setSetting('cj_balance_low', '1');
          log.error(`CJ balance €${balJson.balance_eur.toFixed(2)} < threshold €${minBalance} — skipping order placement`);
          eventBus.publish({
            type: 'alert',
            level: 'error',
            message: `⚠️ CJ-Guthaben €${balJson.balance_eur.toFixed(2)} unter Schwelle €${minBalance}. Bitte CJ-Konto aufladen, sonst failen alle neuen Orders.`,
          });
          try {
            recordWorkerEvent('cj-fulfillment', 'error', 'balance_low', {
              balance_eur: balJson.balance_eur,
              threshold: minBalance,
            });
          } catch { /* */ }
          return;
        }
        // Clear stale flag once balance recovers.
        if (getSetting('cj_balance_low') === '1') setSetting('cj_balance_low', '0');
      }
    } else {
      // TODO: CJ-Balance-API ist verfügbar (cj-service /api/balance), aber
      // hat hier non-200 zurückgegeben — fallthrough. Falls der Endpoint
      // gar nicht existiert, ist das hier ein 404 und wir machen weiter.
    }
  } catch (err) {
    // TODO: CJ-Balance-API integrieren — derzeit kein Pre-Flight, Orders
    // failen bei zu wenig Guthaben mit cryptic Error.
    log.debug('CJ balance pre-flight skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Find paid sales that have no CJ order yet AND have a CJ product mapping.
  // FIX 2: include 'quota_exhausted' rows from previous ticks so they get
  // re-picked once quota refreshes. We allow them in via a LEFT JOIN +
  // status filter rather than excluding all cj_orders.sale_ids outright.
  const rows = db.prepare(`
    SELECT s.id AS sale_id,
           s.buyer_name,
           s.buyer_address,
           s.buyer_phone,
           s.buyer_country,
           s.marketplace,
           cp.cj_variant_id,
           cp.cj_product_id,
           cp.cost_eur,
           ml.folder_num
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      JOIN marketplace_listings ml
        ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
       AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
      JOIN cj_products cp ON cp.folder_num = ml.folder_num
     WHERE s.paid_at IS NOT NULL
       AND (
         s.id NOT IN (SELECT sale_id FROM cj_orders)
         OR s.id IN (SELECT sale_id FROM cj_orders WHERE status = 'quota_exhausted')
       )
     ORDER BY
       CASE WHEN s.id IN (SELECT sale_id FROM cj_orders WHERE status = 'quota_exhausted') THEN 0 ELSE 1 END,
       s.paid_at ASC
     LIMIT ?
  `).all(Math.min(MAX_PER_CYCLE, maxDaily - dailyCount)) as Array<{
    sale_id: number;
    buyer_name: string;
    buyer_address: string | null;
    buyer_phone: string | null;
    buyer_country: string | null;
    marketplace: string | null;
    cj_variant_id: string;
    cj_product_id: string;
    cost_eur: number | null;
    folder_num: number;
  }>;

  if (rows.length === 0) return;
  log.info(`Found ${rows.length} sales to fulfill via CJ`);

  // FIX 2: prepared cleanup for sales that had a 'quota_exhausted' marker —
  // delete it so the upcoming INSERT for the real order can succeed (sale_id
  // is the dedupe key on cj_orders).
  const clearQuotaMarker = db.prepare(`
    DELETE FROM cj_orders WHERE sale_id = ? AND status = 'quota_exhausted'
  `);
  // FIX 4: soft-reservation guard. We bump cj_stock_reserved_at on the
  // auto_listing row so any parallel worker / second orchestrator instance
  // sees the reservation and skips the same variant. Skip if reserved <2min ago.
  const reserveStmt = db.prepare(`
    UPDATE auto_listings
       SET cj_stock_reserved_at = datetime('now')
     WHERE folder_num = ?
       AND (cj_stock_reserved_at IS NULL
            OR cj_stock_reserved_at < datetime('now', '-2 minutes'))
  `);
  const checkReservedRecent = db.prepare(`
    SELECT 1 FROM auto_listings
     WHERE folder_num = ?
       AND cj_stock_reserved_at IS NOT NULL
       AND cj_stock_reserved_at > datetime('now', '-2 minutes')
     LIMIT 1
  `);

  for (const row of rows) {
    // Clear any quota_exhausted marker for this sale so the real order INSERT
    // can land (cj_orders has implicit dedupe on sale_id via INSERT OR IGNORE).
    clearQuotaMarker.run(row.sale_id);
    // Safety: cost is required for the limit check. Without it we'd happily
    // place orders of unknown price.
    if (!row.cost_eur || row.cost_eur <= 0) {
      log.warn(`Skipping sale #${row.sale_id}: cj_products.cost_eur missing for folder #${row.folder_num}`);
      db.prepare(`
        INSERT OR IGNORE INTO cj_orders (sale_id, status, error, created_at, updated_at)
        VALUES (?, 'failed', ?, datetime('now'), datetime('now'))
      `).run(row.sale_id, `Missing cj_products.cost_eur for folder #${row.folder_num}`);
      continue;
    }
    if (row.cost_eur > maxOrderEur) {
      log.warn(`Skipping sale #${row.sale_id}: CJ cost €${row.cost_eur} exceeds limit €${maxOrderEur}`);
      db.prepare(`
        INSERT OR IGNORE INTO cj_orders (sale_id, status, error, created_at, updated_at)
        VALUES (?, 'failed', ?, datetime('now'), datetime('now'))
      `).run(row.sale_id, `Cost €${row.cost_eur} exceeds limit €${maxOrderEur}`);
      continue;
    }

    const runId = startBotRun('cj', `auto-order:sale-${row.sale_id}`);
    try {
      // Parse buyer address JSON
      let addr = { name: '', street: '', city: '', zip: '', country: 'DE', phone: '' };
      if (row.buyer_address) {
        try {
          const parsed = JSON.parse(row.buyer_address);
          addr = {
            name: parsed.name ?? row.buyer_name,
            street: parsed.street ?? parsed.address ?? '',
            city: parsed.city ?? '',
            zip: parsed.zip ?? parsed.postal_code ?? '',
            country: parsed.country ?? row.buyer_country ?? 'DE',
            phone: parsed.phone ?? row.buyer_phone ?? '',
          };
        } catch {
          addr.name = row.buyer_name;
          addr.country = row.buyer_country ?? 'DE';
          addr.phone = row.buyer_phone ?? '';
        }
      }

      // Skip placeholders inserted by sold-items-poller awaiting full poll.
      if (addr.name === 'PENDING' || row.buyer_name === 'PENDING') {
        log.debug('Skipping sale — buyer info still pending poll', { saleId: row.sale_id });
        continue;  // don't even create a cj_orders row; revisit next tick
      }

      // Pre-flight 1: address must be shippable. Saves us a 48h stuck-alert
      // because CJ accepted a half-empty address and the package never moved.
      const addrErr = validateBuyerAddress(addr);
      if (addrErr) {
        log.warn('Skipping sale — invalid address', { saleId: row.sale_id, reason: addrErr });
        db.prepare(`
          INSERT OR IGNORE INTO cj_orders (sale_id, status, error, created_at, updated_at)
          VALUES (?, 'failed', ?, datetime('now'), datetime('now'))
        `).run(row.sale_id, `Invalid buyer address: ${addrErr}`);
        eventBus.publish({
          type: 'alert',
          level: 'error',
          message: `❌ Sale #${row.sale_id}: Adresse fehlerhaft (${addrErr}). Bitte manuell in sales.buyer_address korrigieren.`,
        });
        finishBotRun(runId, 'failure', `Invalid address: ${addrErr}`);
        continue;
      }

      // Pre-flight 2: inventory check. Avoids placing an order for a variant
      // that's out of stock — CJ would reject it 24h later and the buyer
      // would already be waiting. 1 extra CJ-API call but worth it.
      try {
        const invRes = await fetch(`${CJ_SERVICE_URL}/api/products/${row.cj_product_id}/inventory`, {
          signal: AbortSignal.timeout(15_000),
        });
        const invJson = await invRes.json() as { ok: boolean; inventory?: Array<{ quantity: number; countryCode?: string; vid?: string }> };
        const totalStock = (invJson.inventory ?? []).reduce((s, w) => s + (w.quantity ?? 0), 0);
        // Variant-level check if the API gives us vid info
        const variantStock = (invJson.inventory ?? [])
          .filter(w => !w.vid || w.vid === row.cj_variant_id)
          .reduce((s, w) => s + (w.quantity ?? 0), 0);
        const effective = variantStock > 0 ? variantStock : totalStock;
        if (effective <= 0) {
          log.warn('Skipping sale — out of stock at CJ', { saleId: row.sale_id, pid: row.cj_product_id, vid: row.cj_variant_id });
          db.prepare(`
            INSERT OR IGNORE INTO cj_orders (sale_id, status, error, created_at, updated_at)
            VALUES (?, 'failed', ?, datetime('now'), datetime('now'))
          `).run(row.sale_id, 'Out of stock at CJ');
          eventBus.publish({
            type: 'alert',
            level: 'error',
            message: `❌ Sale #${row.sale_id}: CJ-Variant ${row.cj_variant_id} ausverkauft. Folder #${row.folder_num} sollte pausiert werden.`,
          });
          finishBotRun(runId, 'failure', 'Out of stock');
          continue;
        }
      } catch (err) {
        // Inventory check is best-effort — if CJ-service is down or rate-limited,
        // fall through to the order attempt rather than blocking sales.
        log.debug('Inventory check skipped', { saleId: row.sale_id, error: err instanceof Error ? err.message : String(err) });
      }

      // FIX 4: TOCTOU soft-reservation. Between the inventory pre-flight
      // above and the createOrder call below, another worker COULD race and
      // place an order for the same variant — burning the last unit. We
      // can't avoid this fully without a CJ-API-side reservation, but we
      // can flag the auto_listing row so parallel orchestrator instances
      // see "reserved <2min ago" and skip.
      const recentlyReserved = checkReservedRecent.get(row.folder_num) as { 1: number } | undefined;
      if (recentlyReserved) {
        log.info('Skipping sale — folder reserved by parallel worker', {
          saleId: row.sale_id, folder: row.folder_num,
        });
        finishBotRun(runId, 'failure', 'reserved by parallel worker');
        continue;
      }
      reserveStmt.run(row.folder_num);

      // Call CJ service to create order
      const res = await fetch(`${CJ_SERVICE_URL}/api/orders/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sale_id: row.sale_id,
          cj_variant_id: row.cj_variant_id,
          customer_name: addr.name,
          country_code: addr.country,
          province: '',
          city: addr.city,
          address: addr.street,
          zip: addr.zip,
          phone: addr.phone,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        log.info('CJ order placed', { saleId: row.sale_id, folder: row.folder_num });
        finishBotRun(runId, 'success');
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📦 CJ-Bestellung für Sale #${row.sale_id} (Folder #${row.folder_num}) aufgegeben.`,
        });
      } else {
        log.warn('CJ order failed', { saleId: row.sale_id, error: json.error });
        finishBotRun(runId, 'failure', json.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('CJ order crashed', { saleId: row.sale_id, error: msg });
      finishBotRun(runId, 'failure', msg);
    }
  }
}

// ── 2. Poll tracking for ordered CJ orders ──────────────────────────────────
async function pollTrackingUpdates(): Promise<void> {
  if (getSetting('cj_auto_tracking_sync') !== 'true') return;

  const db = getDb();
  // Only poll orders that haven't been checked in the last cooldown window.
  // Without this we'd re-poll the same order every tick → burns CJ quota.
  const rows = db.prepare(`
    SELECT id, cj_order_id, sale_id, ordered_at, stuck_alerted_at
      FROM cj_orders
     WHERE status = 'ordered'
       AND cj_order_id IS NOT NULL
       AND (last_tracking_poll_at IS NULL
            OR last_tracking_poll_at < datetime('now', '-${TRACKING_POLL_COOLDOWN_H} hours'))
     ORDER BY ordered_at ASC
     LIMIT ?
  `).all(MAX_PER_CYCLE) as Array<{
    id: number;
    cj_order_id: string;
    sale_id: number;
    ordered_at: string | null;
    stuck_alerted_at: string | null;
  }>;

  if (rows.length === 0) return;
  log.info(`Polling tracking for ${rows.length} orders`);

  const stampPoll = db.prepare(`UPDATE cj_orders SET last_tracking_poll_at = datetime('now') WHERE id = ?`);

  // Smart-handoff settings — let advanced users tune the carrier classification.
  const preferEu = getSetting('cj_tracking_prefer_eu_carrier') !== 'false'; // default ON
  const forcePushAfter = Math.max(2, Math.min(13, Number(getSetting('cj_tracking_force_push_days') ?? '9')));

  for (const row of rows) {
    try {
      const res = await fetch(
        `${CJ_SERVICE_URL}/api/tracking/${row.cj_order_id}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const json = await res.json() as {
        ok: boolean;
        tracking?: { trackingNumber: string; logisticName: string; trackDetails?: Array<{ date: string; info: string }> };
      };
      stampPoll.run(row.id);

      if (json.ok && json.tracking?.trackingNumber) {
        const t = json.tracking;
        const orderAgeDays = row.ordered_at
          ? (Date.now() - new Date(row.ordered_at).getTime()) / 86_400_000
          : 0;
        // History first — CJ sometimes reports "CJPacket" as the top-level
        // logisticName but the trackDetails contain the actual EU hand-over
        // event ("Package handed over to DHL Deutschland").
        const handover = findEuHandoverInHistory(t.trackDetails);
        const effectiveCarrier = handover?.carrier ?? t.logisticName;
        const bucket = classifyCarrier(effectiveCarrier);
        const decision = classifyTracking({
          logisticName: effectiveCarrier,
          orderAgeDays,
          forcePushAfterDays: forcePushAfter,
          preferEu,
        });

        // Persist what we saw, regardless of pushable.
        const isEu = bucket === 'eu';
        if (isEu) {
          db.prepare(`
            UPDATE cj_orders
               SET eu_tracking_number = ?, eu_logistic_name = ?,
                   eu_handover_at = COALESCE(eu_handover_at, datetime('now')),
                   tracking_push_state = CASE WHEN tracking_push_state = 'pushed' THEN 'pushed' ELSE 'eu_ready' END,
                   updated_at = datetime('now')
             WHERE id = ?
          `).run(t.trackingNumber, effectiveCarrier, row.id);
        } else {
          // CN/unknown — remember the number, mark first-seen, but keep state awaiting.
          db.prepare(`
            UPDATE cj_orders
               SET cn_tracking_number = ?, cn_logistic_name = ?,
                   cn_first_seen_at = COALESCE(cn_first_seen_at, datetime('now')),
                   updated_at = datetime('now')
             WHERE id = ?
          `).run(t.trackingNumber, t.logisticName, row.id);
        }

        if (decision.pushable) {
          // Push to sale + flip state. Fallback gets its own state for visibility.
          // Also bump cj_orders.status to 'shipping' so `uploadTrackingToMarketplaces`
          // picks the row up on its next tick (that worker filters on status).
          const state = isEu ? 'pushed' : 'fallback';
          db.prepare(`UPDATE sales SET tracking_number = ? WHERE id = ?`)
            .run(t.trackingNumber, row.sale_id);
          db.prepare(`
            UPDATE cj_orders
               SET tracking_number = ?, logistic_name = ?, tracking_push_state = ?,
                   status = 'shipping',
                   shipped_at = COALESCE(shipped_at, datetime('now')),
                   updated_at = datetime('now')
             WHERE id = ?
          `).run(t.trackingNumber, effectiveCarrier, state, row.id);

          log.info('Tracking pushed', {
            saleId: row.sale_id, bucket, state,
            tracking: t.trackingNumber, carrier: effectiveCarrier,
            reason: decision.reason,
          });
          eventBus.publish({
            type: 'alert',
            level: 'warn',
            message: isEu
              ? `🚚 Sale #${row.sale_id}: EU-Tracking ${effectiveCarrier} — gepuscht`
              : `⚠️ Sale #${row.sale_id}: Fallback-Push nach ${Math.round(orderAgeDays)}d, kein EU-Carrier gesehen`,
          });
        } else {
          // Held back — log for visibility, no marketplace push yet.
          log.info('Tracking held — waiting for EU handover', {
            saleId: row.sale_id, bucket,
            cnCarrier: t.logisticName,
            orderAgeDays: orderAgeDays.toFixed(1),
            reason: decision.reason,
          });
        }
        continue;
      }

      // No tracking yet — check if the order is stuck (no tracking after threshold)
      if (row.ordered_at && !row.stuck_alerted_at) {
        const ageH = (Date.now() - new Date(row.ordered_at).getTime()) / 3_600_000;
        if (ageH > STUCK_ORDER_THRESHOLD_H) {
          db.prepare(`UPDATE cj_orders SET stuck_alerted_at = datetime('now') WHERE id = ?`).run(row.id);
          log.warn('CJ order stuck without tracking', { saleId: row.sale_id, ageHours: Math.round(ageH) });
          eventBus.publish({
            type: 'alert',
            level: 'error',
            message: `⚠️ Sale #${row.sale_id}: CJ-Order seit ${Math.round(ageH)}h ohne Tracking — bitte manuell prüfen.`,
          });
        }
      }
    } catch (err) {
      stampPoll.run(row.id); // count the attempt even on failure so we don't hammer
      log.warn('Tracking poll failed', {
        cjOrderId: row.cj_order_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── 3. Auto-upload tracking to selling marketplace ──────────────────────────
async function uploadTrackingToMarketplaces(): Promise<void> {
  const db = getDb();

  // Find CJ orders with tracking that haven't been uploaded to the marketplace.
  // Use listings.vinted_item_id directly as the external_id (more reliable
  // than joining marketplace_listings, which gets overwritten on re-list).
  const rows = db.prepare(`
    SELECT co.id, co.sale_id, co.tracking_number, co.logistic_name,
           s.marketplace, s.id AS sale_db_id,
           CAST(l.vinted_item_id AS TEXT) AS external_id,
           l.account_id
      FROM cj_orders co
      JOIN sales s ON s.id = co.sale_id
      JOIN listings l ON l.id = s.listing_id
     WHERE co.status = 'shipping'
       AND co.tracking_number IS NOT NULL
       AND s.tracking_sent_at IS NULL
       AND l.vinted_item_id IS NOT NULL
     ORDER BY co.shipped_at ASC
     LIMIT ?
  `).all(MAX_PER_CYCLE) as Array<{
    id: number;
    sale_id: number;
    tracking_number: string;
    logistic_name: string | null;
    marketplace: string | null;
    sale_db_id: number;
    external_id: string | null;
    account_id: number | null;
  }>;

  if (rows.length === 0) return;

  for (const row of rows) {
    const mp = (row.marketplace ?? 'vinted') as MarketplaceId;
    const botUrl = BOT_ENDPOINTS[mp];

    if (!botUrl || !row.external_id) continue;

    try {
      const res = await fetch(`${botUrl}/api/tracking/upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account_id: row.account_id ?? 1,
          external_id: row.external_id,
          tracking_number: row.tracking_number,
          carrier: row.logistic_name ?? 'other',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        log.info(`Tracking uploaded to ${mp}`, {
          saleId: row.sale_id,
          tracking: row.tracking_number,
        });
      } else {
        // Non-fatal — chat-based tracking message is the fallback
        log.info(`Tracking upload to ${mp} skipped (${json.error}) — using chat fallback`);
      }
    } catch {
      log.debug(`Tracking upload to ${mp} failed — using chat fallback`);
    }
  }
}

// ── 4. Poll for delivery confirmation ───────────────────────────────────────
async function pollDeliveryConfirmation(): Promise<void> {
  const db = getDb();

  // Orders that are 'shipping' for >5d AND haven't been polled in the cooldown.
  // Delivery status changes at most ~1×/day, so polling more often is waste.
  const rows = db.prepare(`
    SELECT id, cj_order_id, sale_id
      FROM cj_orders
     WHERE status = 'shipping'
       AND cj_order_id IS NOT NULL
       AND shipped_at < datetime('now', '-5 days')
       AND (last_delivery_poll_at IS NULL
            OR last_delivery_poll_at < datetime('now', '-${DELIVERY_POLL_COOLDOWN_H} hours'))
     ORDER BY shipped_at ASC
     LIMIT ?
  `).all(MAX_PER_CYCLE) as Array<{
    id: number;
    cj_order_id: string;
    sale_id: number;
  }>;

  if (rows.length === 0) return;
  log.info(`Polling delivery for ${rows.length} orders`);

  const stampPoll = db.prepare(`UPDATE cj_orders SET last_delivery_poll_at = datetime('now') WHERE id = ?`);

  for (const row of rows) {
    try {
      const res = await fetch(
        `${CJ_SERVICE_URL}/api/orders/${row.cj_order_id}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const json = await res.json() as {
        ok: boolean;
        order?: { orderStatus: string };
      };
      stampPoll.run(row.id);

      if (json.ok && json.order) {
        const cjStatus = json.order.orderStatus?.toLowerCase();
        if (cjStatus === 'delivered' || cjStatus === 'completed') {
          db.prepare(`
            UPDATE cj_orders
               SET status = 'delivered',
                   delivered_at = datetime('now'),
                   updated_at = datetime('now')
             WHERE id = ?
          `).run(row.id);

          log.info('CJ order delivered', { saleId: row.sale_id });

          eventBus.publish({
            type: 'alert',
            level: 'warn',
            message: `✅ Sale #${row.sale_id} geliefert — Auszahlung wird freigeschaltet.`,
          });
        }
      }
    } catch (err) {
      stampPoll.run(row.id);
      log.warn('Delivery check failed', {
        cjOrderId: row.cj_order_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startCJFulfillment(): void {
  if (timer) return;
  log.info('CJ fulfillment worker started', { intervalMs: POLL_INTERVAL_MS });
  setTimeout(() => void tick(), 60_000); // wait for CJ service to boot
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopCJFulfillment(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('CJ fulfillment worker stopped');
  }
}
