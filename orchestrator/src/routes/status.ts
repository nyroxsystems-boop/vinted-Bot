import { Router } from 'express';
import { getDb } from '@vinted-system/shared';
import { vintedClient } from '../bot-clients/vinted.js';
import { temuClient } from '../bot-clients/temu.js';

export const statusRouter = Router();

statusRouter.get('/', async (_req, res) => {
  const [vinted, temu] = await Promise.allSettled([vintedClient.status(), temuClient.status()]);

  const kpis = (getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM listings WHERE status = 'active')         AS active_listings,
         (SELECT COUNT(*) FROM offers WHERE state = 'pending')           AS pending_offers,
         (SELECT COUNT(*) FROM sales WHERE paid_at IS NOT NULL AND shipped_at IS NULL) AS pending_sales,
         (SELECT COUNT(*) FROM temu_orders WHERE state = 'placed')       AS open_temu_orders,
         (SELECT COUNT(*) FROM temu_orders WHERE state = 'failed')       AS failed_temu_orders`,
    )
    .get()) as Record<string, number>;

  res.json({
    kpis,
    bots: {
      vinted: vinted.status === 'fulfilled' ? vinted.value : { error: String(vinted.reason) },
      temu: temu.status === 'fulfilled' ? temu.value : { error: String(temu.reason) },
    },
  });
});

statusRouter.get('/runs', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM bot_runs ORDER BY started_at DESC LIMIT 100')
    .all();
  res.json(rows);
});
