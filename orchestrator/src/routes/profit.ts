// ──────────────────────────────────────────────────────────────────────────────
// Profit Analytics API Routes
//
// Cross-platform profit calculation and performance analytics.
// Aggregates data from all marketplaces, CJ orders, and sales.
//
// Cost model:
//   cost = temu_price + shipping + marketplace_fee
//   Vinted fee: 5% of sale price + €0.70 per transaction
//   Default shipping: €4.99 (Hermes S) — configurable per listing later
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { getDb, getSetting } from '@vinted-system/shared';

const router = Router();

// Vinted fee structure (as of 2026)
const VINTED_FEE_PCT = 0.05;
const VINTED_FEE_FIXED = 0.70;
const DEFAULT_SHIPPING_EUR = 4.99;

/** Overall profit summary across all marketplaces */
router.get('/summary', (_req, res) => {
  try {
    const db = getDb();

    // Total revenue & cost — pulls Temu purchase price via auto_listings
    const shippingEur = Number.parseFloat(getSetting('default_shipping_eur') ?? String(DEFAULT_SHIPPING_EUR));
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total_sales,
        COALESCE(SUM(l.list_price_eur), 0) AS total_revenue,
        COALESCE(SUM(COALESCE(al.temu_price_eur, 0)), 0) AS total_cost,
        COUNT(*) * ? AS total_shipping_cost,
        COALESCE(SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?), 0) AS total_profit,
        CASE WHEN SUM(l.list_price_eur) > 0
          THEN ROUND(100.0 * SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?)
               / SUM(l.list_price_eur), 1)
          ELSE 0 END AS avg_margin_pct
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      LEFT JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
      WHERE s.paid_at IS NOT NULL
    `).get(shippingEur, VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur, VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur) as Record<string, number>;

    // Per marketplace breakdown
    const byMarketplace = db.prepare(`
      SELECT
        COALESCE(s.marketplace, 'vinted') AS marketplace,
        COUNT(*) AS sales,
        COALESCE(SUM(l.list_price_eur), 0) AS revenue,
        COALESCE(SUM(COALESCE(al.temu_price_eur, 0)), 0) AS cost,
        COALESCE(SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?), 0) AS profit
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      LEFT JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
      WHERE s.paid_at IS NOT NULL
      GROUP BY COALESCE(s.marketplace, 'vinted')
      ORDER BY profit DESC
    `).all(VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur);

    // Daily revenue for chart (last 30 days)
    const daily = db.prepare(`
      SELECT
        date(s.paid_at) AS day,
        COUNT(*) AS sales,
        COALESCE(SUM(l.list_price_eur), 0) AS revenue,
        COALESCE(SUM(COALESCE(al.temu_price_eur, 0)), 0) AS cost,
        COALESCE(SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?), 0) AS profit
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      LEFT JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
      WHERE s.paid_at > datetime('now', '-30 days')
      GROUP BY date(s.paid_at)
      ORDER BY day ASC
    `).all(VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur);

    // CJ fulfillment stats
    const cjStats = db.prepare(`
      SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'shipping' THEN 1 ELSE 0 END) AS in_transit,
        SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END) AS ordered,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        AVG(CASE WHEN delivered_at IS NOT NULL
            THEN julianday(delivered_at) - julianday(ordered_at)
            ELSE NULL END) AS avg_delivery_days
      FROM cj_orders
    `).get() as Record<string, number>;

    // Top performing products
    const topProducts = db.prepare(`
      SELECT
        l.title,
        COUNT(*) AS sales,
        COALESCE(SUM(l.list_price_eur), 0) AS revenue,
        COALESCE(SUM(COALESCE(al.temu_price_eur, 0)), 0) AS cost,
        COALESCE(SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?), 0) AS profit,
        CASE WHEN SUM(l.list_price_eur) > 0
          THEN ROUND(100.0 * SUM(l.list_price_eur * (1 - ?) - ? - COALESCE(al.temu_price_eur, 0) - ?)
               / SUM(l.list_price_eur), 1)
          ELSE 0 END AS margin_pct
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      LEFT JOIN auto_listings al ON al.vinted_item_id = l.vinted_item_id
      WHERE s.paid_at IS NOT NULL
      GROUP BY l.id
      ORDER BY profit DESC
      LIMIT 20
    `).all(VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur, VINTED_FEE_PCT, VINTED_FEE_FIXED, shippingEur);

    // Active listings count per marketplace
    const activeListings = db.prepare(`
      SELECT marketplace, COUNT(*) AS count
      FROM marketplace_listings
      WHERE status = 'active'
      GROUP BY marketplace
    `).all();

    res.json({
      ok: true,
      totals,
      byMarketplace,
      daily,
      cjStats,
      topProducts,
      activeListings,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Payout tracker — which sales have been paid out by the marketplace */
router.get('/payouts', (_req, res) => {
  try {
    const db = getDb();

    const payouts = db.prepare(`
      SELECT
        COALESCE(s.marketplace, 'vinted') AS marketplace,
        COUNT(CASE WHEN s.feedback_left_at IS NOT NULL THEN 1 END) AS completed_sales,
        COUNT(CASE WHEN s.tracking_sent_at IS NOT NULL AND s.feedback_left_at IS NULL THEN 1 END) AS awaiting_payout,
        COALESCE(SUM(CASE WHEN s.feedback_left_at IS NOT NULL THEN l.list_price_eur ELSE 0 END), 0) AS paid_out_eur,
        COALESCE(SUM(CASE WHEN s.tracking_sent_at IS NOT NULL AND s.feedback_left_at IS NULL THEN l.list_price_eur ELSE 0 END), 0) AS pending_payout_eur
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
      WHERE s.paid_at IS NOT NULL
      GROUP BY COALESCE(s.marketplace, 'vinted')
    `).all();

  res.json({ ok: true, payouts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

/** Cross-sync stats — how many double-sells were prevented */
router.get('/cross-sync-stats', (_req, res) => {
  try {
    const db = getDb();

    // Check if table exists first
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cross_sync_log'`,
    ).get();

    if (!tableExists) {
      res.json({
        ok: true,
        stats: { total: 0, deactivated: 0, failed: 0, pending: 0 },
      });
      return;
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'deactivated' THEN 1 ELSE 0 END) AS deactivated,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM cross_sync_log
    `).get() as Record<string, number>;

    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

export const profitRouter = router;
