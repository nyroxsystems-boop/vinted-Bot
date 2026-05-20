// ──────────────────────────────────────────────────────────────────────────────
// CJ Dropshipping API Routes
//
// Dashboard-facing endpoints for managing CJ product mappings and orders.
// These proxy to the CJ Service (:4702) for actual CJ API calls,
// and manage local DB state for the mapping tables.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getDb, getCjQuotaUsage } from '@vinted-system/shared';
import { runOnce as runCjAutoMatch } from '../cj-auto-matcher.js';

const log = createLogger('routes:cj');
const router = Router();

const CJ_SERVICE_URL = process.env.CJ_SERVICE_URL ?? 'http://localhost:4702';

// ── CJ-Quota Usage ──────────────────────────────────────────────────────────
// Tracks how many of the 1000/day CJ-API-calls have been used. The dashboard
// shows this as a progress-bar; the auto-publisher reads it to throttle
// discovery once we cross 80%.
router.get('/quota', (_req, res) => {
  try {
    res.json({ ok: true, ...getCjQuotaUsage() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── CJ Product Mappings ─────────────────────────────────────────────────────

/** List all CJ product mappings */
router.get('/products', (_req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT cp.*, al.title, al.price_eur AS sell_price_eur
        FROM cj_products cp
   LEFT JOIN auto_listings al ON al.folder_num = cp.folder_num
       ORDER BY cp.folder_num ASC
    `).all();
    res.json({ ok: true, products: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Add / update a CJ product mapping for a folder */
router.post('/products', (req, res) => {
  try {
    const { folder_num, cj_product_id, cj_variant_id, cj_product_url, cost_eur, shipping_eur, warehouse } = req.body;
    if (!folder_num || !cj_product_id || !cj_variant_id) {
      return res.status(400).json({ ok: false, error: 'folder_num, cj_product_id, cj_variant_id required' });
    }
    const row = getDb().prepare(`
      INSERT INTO cj_products (folder_num, cj_product_id, cj_variant_id, cj_product_url, cost_eur, shipping_eur, warehouse)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_num, cj_variant_id) DO UPDATE SET
        cj_product_id = excluded.cj_product_id,
        cj_product_url = excluded.cj_product_url,
        cost_eur = excluded.cost_eur,
        shipping_eur = excluded.shipping_eur,
        warehouse = excluded.warehouse
      RETURNING *
    `).get(
      folder_num, cj_product_id, cj_variant_id,
      cj_product_url ?? null, cost_eur ?? null, shipping_eur ?? null, warehouse ?? 'CN',
    );
    log.info('CJ product mapping upserted', { folder_num, cj_product_id });
    res.json({ ok: true, product: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Delete a CJ product mapping */
router.delete('/products/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM cj_products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── CJ Orders ───────────────────────────────────────────────────────────────

/** List all CJ orders with sale info */
router.get('/orders', (_req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT co.*,
             s.buyer_name,
             l.title AS listing_title,
             l.list_price_eur AS sell_price_eur,
             co.cost_total_eur AS cost_eur
        FROM cj_orders co
        JOIN sales s ON s.id = co.sale_id
   LEFT JOIN listings l ON l.id = s.listing_id
       ORDER BY co.created_at DESC
    `).all();
    res.json({ ok: true, orders: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Get a single CJ order detail */
router.get('/orders/:id', (req, res) => {
  try {
    const row = getDb().prepare(`
      SELECT co.*, s.buyer_name, s.buyer_address, l.title AS listing_title
        FROM cj_orders co
        JOIN sales s ON s.id = co.sale_id
   LEFT JOIN listings l ON l.id = s.listing_id
       WHERE co.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, order: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Manually trigger a CJ order for a sale */
router.post('/orders/create', async (req, res) => {
  try {
    const r = await fetch(`${CJ_SERVICE_URL}/api/orders/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── CJ Product Search (proxy to CJ service) ────────────────────────────────

router.get('/search', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const r = await fetch(`${CJ_SERVICE_URL}/api/products/search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── CJ Profit Summary ──────────────────────────────────────────────────────

router.get('/profit', (_req, res) => {
  try {
    const summary = getDb().prepare(`
      SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN co.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN co.status = 'shipping' THEN 1 ELSE 0 END) AS in_transit,
        SUM(CASE WHEN co.status = 'ordered' THEN 1 ELSE 0 END) AS ordered,
        SUM(CASE WHEN co.status = 'failed' THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(co.cost_total_eur), 0) AS total_cost_eur,
        COALESCE(SUM(l.list_price_eur), 0) AS total_revenue_eur,
        COALESCE(SUM(l.list_price_eur) - SUM(co.cost_total_eur), 0) AS total_profit_eur
      FROM cj_orders co
      JOIN sales s ON s.id = co.sale_id
      LEFT JOIN listings l ON l.id = s.listing_id
    `).get();
    res.json({ ok: true, ...summary as Record<string, unknown> });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Health-check: ping the CJ service with the configured credentials.
 *  Returns ok:true if cj-service is reachable AND can authenticate, false
 *  otherwise. Used by the Onboarding wizard's "Verbindung testen" button. */
router.get('/ping', async (_req, res) => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(`${CJ_SERVICE_URL}/health/auth`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      return res.status(200).json({ ok: false, error: `CJ-Service status ${r.status}` });
    }
    const data = await r.json().catch(() => ({}));
    return res.json({ ok: true, ...data });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : 'CJ-Service nicht erreichbar',
    });
  }
});

/** GET /api/cj/match-status — summary for the Pipeline → CJ-Mapping tab.
 *  Counts + recent matches + unmatched listings + smart-tracking state. */
router.get('/match-status', (_req, res) => {
  try {
    const db = getDb();
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM auto_listings WHERE status NOT IN ('archived','sold'))                                                    AS total,
        (SELECT COUNT(*) FROM auto_listings WHERE status NOT IN ('archived','sold') AND cj_variant_id IS NOT NULL AND cj_variant_id != '') AS matched,
        (SELECT COUNT(*) FROM auto_listings WHERE status NOT IN ('archived','sold') AND (cj_variant_id IS NULL OR cj_variant_id = ''))     AS unmatched
    `).get() as { total: number; matched: number; unmatched: number };

    const recentMatched = db.prepare(`
      SELECT al.folder_num, al.title, cp.cj_product_id, cp.cj_variant_id, cp.cost_eur, cp.created_at
        FROM auto_listings al
        JOIN cj_products cp ON cp.folder_num = al.folder_num
       WHERE al.cj_variant_id IS NOT NULL AND al.cj_variant_id != ''
       ORDER BY cp.created_at DESC
       LIMIT 10
    `).all();

    const stillUnmatched = db.prepare(`
      SELECT folder_num, title, status, created_at
        FROM auto_listings
       WHERE (cj_variant_id IS NULL OR cj_variant_id = '')
         AND status NOT IN ('archived','sold')
       ORDER BY created_at DESC
       LIMIT 20
    `).all();

    // Smart-tracking distribution across orders that haven't been delivered yet.
    const trackingStates = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tracking_push_state = 'awaiting' THEN 1 ELSE 0 END), 0) AS awaiting,
        COALESCE(SUM(CASE WHEN tracking_push_state = 'eu_ready' THEN 1 ELSE 0 END), 0) AS eu_ready,
        COALESCE(SUM(CASE WHEN tracking_push_state = 'pushed'   THEN 1 ELSE 0 END), 0) AS pushed,
        COALESCE(SUM(CASE WHEN tracking_push_state = 'fallback' THEN 1 ELSE 0 END), 0) AS fallback
      FROM cj_orders
      WHERE status IN ('ordered','shipping')
    `).get() as { awaiting: number; eu_ready: number; pushed: number; fallback: number };

    const recentTracking = db.prepare(`
      SELECT co.sale_id, co.cj_order_id, co.tracking_push_state,
             co.cn_logistic_name, co.cn_first_seen_at,
             co.eu_logistic_name, co.eu_handover_at,
             co.tracking_number, co.logistic_name,
             co.ordered_at
        FROM cj_orders co
       WHERE co.status IN ('ordered','shipping')
       ORDER BY co.created_at DESC
       LIMIT 15
    `).all();

    res.json({
      ok: true,
      counts,
      recent_matched: recentMatched,
      unmatched: stillUnmatched,
      tracking_states: trackingStates,
      recent_tracking: recentTracking,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** POST /api/cj/auto-match — run the matcher synchronously and return the
 *  detailed result. Body: { limit?: number, folder_num?: number }. */
router.post('/auto-match', async (req, res) => {
  try {
    const { limit, folder_num } = req.body as { limit?: number; folder_num?: number };
    if (Number.isInteger(folder_num)) {
      const row = getDb()
        .prepare(`SELECT folder_num, title FROM auto_listings WHERE folder_num = ?`)
        .get(folder_num) as { folder_num: number; title: string } | undefined;
      if (!row) return res.status(404).json({ ok: false, error: 'folder not found' });
      const db = getDb();
      db.prepare(`UPDATE auto_listings SET cj_variant_id = NULL WHERE folder_num = ?`).run(folder_num);
      db.prepare(`DELETE FROM cj_products WHERE folder_num = ?`).run(folder_num);
      const result = await runCjAutoMatch({ limit: 1 });
      return res.json({ ok: true, ...result });
    }
    const result = await runCjAutoMatch({ limit });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('manual auto-match failed', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

export const cjRouter = router;
