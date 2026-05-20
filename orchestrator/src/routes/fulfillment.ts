// ──────────────────────────────────────────────────────────────────────────────
// Fulfillment routes — CJ-only.
// Legacy Temu batch-cart routes were removed when fulfillment migrated to
// CJ Dropshipping. See routes/cj.ts for the active CJ-fulfillment endpoints.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { getDb } from '@vinted-system/shared';

export const fulfillmentRouter = Router();

/**
 * GET /api/fulfillment/queue?hours=24
 * Lists paid sales that don't have a CJ order yet — the queue the CJ
 * fulfillment worker will pick up on its next tick.
 */
fulfillmentRouter.get('/queue', (req, res) => {
  const hours = Math.max(1, Math.min(168, Number.parseInt(String(req.query.hours ?? '24'), 10)));
  const rows = getDb()
    .prepare(
      `SELECT s.id              AS sale_id,
              s.paid_at,
              s.buyer_name,
              s.marketplace,
              l.id              AS listing_id,
              l.title           AS listing_title,
              l.list_price_eur,
              cp.cj_variant_id,
              cp.cost_eur
         FROM sales s
         JOIN listings l ON l.id = s.listing_id
    LEFT JOIN marketplace_listings ml
           ON ml.external_id = CAST(l.vinted_item_id AS TEXT)
          AND ml.marketplace = COALESCE(s.marketplace, 'vinted')
    LEFT JOIN cj_products cp ON cp.folder_num = ml.folder_num
        WHERE s.paid_at IS NOT NULL
          AND s.paid_at > datetime('now', ?)
          AND s.id NOT IN (SELECT sale_id FROM cj_orders)
        ORDER BY s.paid_at DESC`,
    )
    .all(`-${hours} hours`);
  res.json({ ok: true, queue: rows, count: rows.length });
});
