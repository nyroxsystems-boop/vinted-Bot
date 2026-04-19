import { Router } from 'express';
import { getDb } from '@vinted-system/shared';
import type { Sale, TemuOrder } from '@vinted-system/shared';

export const ordersRouter = Router();

// Combined view of sales + their Temu orders — that's the thing the
// dashboard actually wants to show in the Orders tab.
ordersRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id            AS sale_id,
              s.listing_id,
              s.buyer_name,
              s.buyer_address,
              s.paid_at,
              s.shipped_at,
              t.id             AS temu_order_pk,
              t.temu_order_id,
              t.state          AS temu_state,
              t.amount_eur     AS temu_amount_eur,
              t.tracking_number,
              t.placed_at      AS temu_placed_at,
              t.last_error     AS temu_last_error,
              l.title          AS listing_title,
              l.temu_url       AS listing_temu_url
         FROM sales s
    LEFT JOIN temu_orders t ON t.sale_id = s.id AND t.state != 'failed'
    LEFT JOIN listings l ON l.id = s.listing_id
        ORDER BY s.created_at DESC`,
    )
    .all();
  res.json(rows);
});

ordersRouter.get('/sales/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const sale = getDb().prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale | undefined;
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const temu = getDb()
    .prepare('SELECT * FROM temu_orders WHERE sale_id = ? ORDER BY id DESC')
    .all(id) as TemuOrder[];
  res.json({ sale, temu });
});
