import { createLogger, getDb, isBotBlocked } from '@vinted-system/shared';
import type { TemuOrder } from '@vinted-system/shared';
import { getTemuBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('temu-track');
const ORDERS_URL = 'https://www.temu.com/bgt_kuiper/orders.html';

/**
 * Poll Temu order pages to update the tracking number / delivered state for
 * placed orders. Best-effort — if selectors drift, the order simply stays in
 * its previous state and last_error is set.
 */
export async function pollTemuOrders(): Promise<{ updated: number }> {
  const db = getDb();
  const open = db
    .prepare(
      `SELECT * FROM temu_orders
         WHERE state = 'placed' AND temu_order_id IS NOT NULL
         ORDER BY id ASC LIMIT 20`,
    )
    .all() as TemuOrder[];
  if (open.length === 0) return { updated: 0 };

  const mb = await getTemuBrowser();
  const page = await mb.context.newPage();
  let updated = 0;

  try {
    await requireLogin(page);
    await page.goto(ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const block = await isBotBlocked(page);
    if (block.blocked) {
      log.warn('Blocked while polling orders', { reason: block.reason });
      return { updated: 0 };
    }

    for (const order of open) {
      try {
        const row = page.locator(`[data-order-id="${order.temu_order_id}"]`).first();
        if ((await row.count()) === 0) continue;
        const statusText = (await row.locator('.order-status, [data-testid="order-status"]').first()
          .innerText({ timeout: 2_000 }).catch(() => ''))
          .toLowerCase();
        const trackingText = (await row.locator('.tracking-number, [data-testid="tracking"]').first()
          .innerText({ timeout: 2_000 }).catch(() => ''))
          .trim();

        let newState: TemuOrder['state'] | null = null;
        if (statusText.includes('delivered') || statusText.includes('zugestellt')) newState = 'delivered';
        else if (statusText.includes('shipped') || statusText.includes('versandt')) newState = 'shipped';
        else if (statusText.includes('cancel') || statusText.includes('stornier')) newState = 'cancelled';

        if (newState || trackingText) {
          db.prepare(
            `UPDATE temu_orders
               SET state = COALESCE(?, state),
                   tracking_number = COALESCE(NULLIF(?, ''), tracking_number),
                   last_checked_at = datetime('now')
             WHERE id = ?`,
          ).run(newState, trackingText, order.id);
          updated++;
        } else {
          db.prepare(`UPDATE temu_orders SET last_checked_at = datetime('now') WHERE id = ?`)
            .run(order.id);
        }
      } catch (err) {
        log.warn('Failed to update order', {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await page.close();
  }
  return { updated };
}
