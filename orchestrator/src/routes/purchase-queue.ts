// ──────────────────────────────────────────────────────────────────────────────
// Purchase-Queue routes
//
// The user has decided to keep the actual Temu checkout manual (no auto-
// payment). Everything else is automated, so this endpoint is the last
// thing they actively do: a list of "open" sales whose Temu product hasn't
// been ordered yet — each with a one-click link to the Temu product page.
//
// GET    /api/purchase-queue          → all paid sales needing a Temu purchase
// POST   /api/purchase-queue/:saleId/mark-purchased  → user clicks "gekauft"
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { getDb } from '@vinted-system/shared';
import { eventBus } from '../events.js';

export const purchaseQueueRouter = Router();

interface QueueRow {
  sale_id: number;
  paid_at: string | null;
  buyer_name: string;
  listing_id: number;
  listing_title: string;
  temu_url: string | null;
  list_price_eur: number;
  temu_order_state: string | null;
  buyer_address: string | null;
}

purchaseQueueRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id              AS sale_id,
              s.paid_at,
              s.buyer_name,
              s.buyer_address,
              l.id              AS listing_id,
              l.title            AS listing_title,
              l.temu_url,
              l.list_price_eur,
              t.state            AS temu_order_state
         FROM sales s
         JOIN listings l ON l.id = s.listing_id
    LEFT JOIN temu_orders t ON t.sale_id = s.id
        WHERE s.paid_at IS NOT NULL
          AND l.temu_url IS NOT NULL
          AND l.temu_url != ''
          AND (t.state IS NULL OR t.state IN ('queued', 'in_cart', 'failed'))
        ORDER BY s.paid_at ASC`,
    )
    .all() as QueueRow[];

  const items = rows.map((r) => ({
    saleId: r.sale_id,
    paidAt: r.paid_at,
    buyer: r.buyer_name,
    buyerAddress: r.buyer_address ? JSON.parse(r.buyer_address) : null,
    listingId: r.listing_id,
    title: r.listing_title,
    temuUrl: r.temu_url,
    listPriceEur: r.list_price_eur,
    state: r.temu_order_state ?? 'needs_purchase',
  }));

  res.json({ count: items.length, items });
});

// User clicks "gekauft" on the dashboard → we record that the Temu order
// was placed manually, so the sale leaves the purchase queue.
purchaseQueueRouter.post('/:saleId/mark-purchased', (req, res) => {
  const saleId = Number.parseInt(req.params.saleId, 10);
  const { temuOrderId } = req.body as { temuOrderId?: string };
  const db = getDb();

  const sale = db
    .prepare('SELECT * FROM sales WHERE id = ?')
    .get(saleId) as { id: number; listing_id: number } | undefined;
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  const existing = db
    .prepare('SELECT id FROM temu_orders WHERE sale_id = ?')
    .get(saleId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE temu_orders
          SET state = 'placed',
              temu_order_id = COALESCE(?, temu_order_id),
              placed_at = datetime('now')
        WHERE id = ?`,
    ).run(temuOrderId ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO temu_orders (sale_id, state, temu_order_id, placed_at, idempotency_key)
       VALUES (?, 'placed', ?, datetime('now'), ?)`,
    ).run(saleId, temuOrderId ?? null, `sale-${saleId}`);
  }

  eventBus.publish({
    type: 'alert',
    level: 'warn',
    message: `🛒 Sale #${saleId} als auf Temu gekauft markiert.`,
  });

  res.json({ ok: true });
});
