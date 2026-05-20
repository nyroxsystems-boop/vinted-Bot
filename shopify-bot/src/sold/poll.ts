// Shopify orders poll — returns sold orders since `sinceMs` timestamp.
import { createLogger, getDb } from '@vinted-system/shared';
import { shopifyFetch } from '../auth/token.js';

const log = createLogger('shopify-sold-poll');

interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string | null;
  total_price: string;
  currency: string;
  created_at: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    variant_id: number | null;
    product_id: number | null;
  }>;
}

interface OrdersResp { orders: ShopifyOrder[] }

export async function pollShopifySold(sinceMs?: number): Promise<{ newSales: number; items: ShopifyOrder[] }> {
  const since = sinceMs ? new Date(sinceMs).toISOString() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const r = await shopifyFetch<OrdersResp>(`/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(since)}&limit=50`);
  if (!r.ok || !r.data) {
    log.warn('orders poll failed', { error: r.error });
    return { newSales: 0, items: [] };
  }
  const db = getDb();
  let newSales = 0;
  for (const order of r.data.orders) {
    for (const item of order.line_items) {
      // Flip marketplace_listings.status='sold' for matching product_id
      if (!item.product_id) continue;
      const ext = `${item.product_id}:${item.variant_id ?? ''}`;
      const upd = db.prepare(`
        UPDATE marketplace_listings
           SET status='sold', updated_at=datetime('now')
         WHERE marketplace='shopify'
           AND external_id LIKE ?
           AND status='active'
      `).run(`${item.product_id}:%`);
      if (upd.changes > 0) {
        newSales++;
        log.info('Shopify sale linked', { externalId: ext, orderId: order.id });
      }
    }
  }
  return { newSales, items: r.data.orders };
}
