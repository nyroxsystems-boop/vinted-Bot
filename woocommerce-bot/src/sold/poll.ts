import { createLogger, getDb } from '@vinted-system/shared';
import { wooFetch } from '../auth/credentials.js';

const log = createLogger('woo-sold-poll');

interface WooOrder {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  date_created: string;
  line_items: Array<{
    id: number;
    name: string;
    product_id: number;
    variation_id: number;
    quantity: number;
    price: number;
  }>;
}

export async function pollWooSold(sinceMs?: number): Promise<{ newSales: number; items: WooOrder[] }> {
  const after = sinceMs
    ? new Date(sinceMs).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // statuses = processing,completed (paid) to count as sale
  const r = await wooFetch<WooOrder[]>(
    `/orders?after=${encodeURIComponent(after)}&status=processing,completed&per_page=50`,
  );
  if (!r.ok || !r.data) {
    log.warn('orders poll failed', { error: r.error });
    return { newSales: 0, items: [] };
  }
  const db = getDb();
  let newSales = 0;
  for (const order of r.data) {
    for (const item of order.line_items) {
      if (!item.product_id) continue;
      const upd = db.prepare(`
        UPDATE marketplace_listings
           SET status='sold', updated_at=datetime('now')
         WHERE marketplace='woocommerce'
           AND external_id = ?
           AND status='active'
      `).run(String(item.product_id));
      if (upd.changes > 0) {
        newSales++;
        log.info('Woo sale linked', { productId: item.product_id, orderId: order.id });
      }
    }
  }
  return { newSales, items: r.data };
}
