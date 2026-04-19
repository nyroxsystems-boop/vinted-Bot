import { Router } from 'express';
import { getDb, getSetting } from '@vinted-system/shared';
import type { TemuBatch } from '@vinted-system/shared';
import { temuClient } from '../bot-clients/temu.js';
import { eventBus } from '../events.js';

export const fulfillmentRouter = Router();

/**
 * GET /api/fulfillment/queue?hours=24
 * Lists all paid sales in the given window that aren't already in a
 * non-failed Temu batch. This is the "what would a new batch contain" view.
 */
fulfillmentRouter.get('/queue', (req, res) => {
  const hours = Math.max(1, Math.min(168, Number.parseInt(String(req.query.hours ?? '24'), 10)));
  const rows = getDb()
    .prepare(
      `SELECT s.id                 AS sale_id,
              s.paid_at,
              s.buyer_name,
              l.id                 AS listing_id,
              l.title              AS listing_title,
              l.temu_url,
              l.temu_variant,
              l.list_price_eur
         FROM sales s
         JOIN listings l ON l.id = s.listing_id
        WHERE s.paid_at IS NOT NULL
          AND s.paid_at > datetime('now', ?)
          AND l.temu_url IS NOT NULL
          AND l.dry_run = 0
          AND NOT EXISTS (
            SELECT 1 FROM temu_orders t
             WHERE t.sale_id = s.id AND t.state NOT IN ('failed','cancelled')
          )
        ORDER BY s.paid_at DESC`,
    )
    .all(`-${hours} hours`);
  res.json({ hours, items: rows });
});

/**
 * GET /api/fulfillment/batches?limit=20
 * Returns recent batches with their current state.
 */
fulfillmentRouter.get('/batches', (req, res) => {
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit ?? '20'), 10)));
  const rows = getDb()
    .prepare('SELECT * FROM temu_batches ORDER BY created_at DESC LIMIT ?')
    .all(limit) as TemuBatch[];
  res.json(rows);
});

/**
 * GET /api/fulfillment/batches/:id
 * Returns a single batch with all its item details.
 */
fulfillmentRouter.get('/batches/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const batch = getDb().prepare('SELECT * FROM temu_batches WHERE id = ?').get(id) as
    | TemuBatch
    | undefined;
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const items = getDb()
    .prepare(
      `SELECT t.id AS temu_order_id_pk, t.sale_id, t.state, t.last_error, t.amount_eur,
              s.buyer_name,
              l.title AS listing_title, l.temu_url, l.list_price_eur, l.min_accept_price_eur
         FROM temu_orders t
         JOIN sales s ON s.id = t.sale_id
         JOIN listings l ON l.id = s.listing_id
        WHERE t.batch_id = ?
        ORDER BY t.id`,
    )
    .all(id);
  res.json({ batch, items });
});

/**
 * POST /api/fulfillment/batches
 * Body: { windowHours?: number }
 * Creates a fresh open batch of all eligible sales in the given window.
 */
fulfillmentRouter.post('/batches', async (req, res) => {
  const configured = Number.parseInt(getSetting('temu_batch_window_hours') ?? '24', 10);
  const windowHours = Number.parseInt(
    String(req.body?.windowHours ?? configured),
    10,
  );
  try {
    const result = await temuClient.createBatch(windowHours);
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `Batch #${result.batchId} erstellt mit ${result.saleCount} Artikeln`,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/fulfillment/batches/:id/add-to-cart
 * Kicks off the bot's add-to-cart run. Returns per-item results.
 */
fulfillmentRouter.post('/batches/:id/add-to-cart', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const result = await temuClient.addBatchToCart(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/fulfillment/batches/:id/mark-placed
 * User manually confirms: "I paid the Temu cart, here's the order ID".
 * Moves batch → 'placed' and all in_cart items → 'placed'.
 */
fulfillmentRouter.post('/batches/:id/mark-placed', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { temuOrderId } = req.body as { temuOrderId?: string };

  const db = getDb();
  const batch = db.prepare('SELECT * FROM temu_batches WHERE id = ?').get(id) as
    | TemuBatch
    | undefined;
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'cart_ready') {
    return res.status(409).json({ error: `Batch status is ${batch.status}, expected cart_ready` });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE temu_batches SET status = 'placed', placed_at = datetime('now') WHERE id = ?`,
    ).run(id);
    db.prepare(
      `UPDATE temu_orders
         SET state = 'placed',
             temu_order_id = COALESCE(?, temu_order_id),
             placed_at = datetime('now')
       WHERE batch_id = ? AND state = 'in_cart'`,
    ).run(temuOrderId ?? null, id);
  });
  tx();

  res.json({ ok: true });
});
