// ──────────────────────────────────────────────────────────────────────────────
// Batch-cart mode: bot walks a list of sales, opens each Temu product URL,
// picks the size variant, and clicks "In den Warenkorb". The user then
// opens the Temu cart themselves and pays for everything at once.
//
// Why batch-cart instead of auto-order?
//   • One Temu shipment for many Vinted sales → fewer packages, lower cost.
//   • User retains final approval over every payment.
//   • No payment-method automation risk (no captchas, no 3DS headaches).
//   • Much lower detection risk — bot just clicks "add to cart" per item,
//     no checkout flow automation.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger, getDb, isBotBlocked } from '@vinted-system/shared';
import type { Listing, Sale, TemuVariant } from '@vinted-system/shared';
import { TEMU } from '../selectors.js';
import { getTemuBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('temu-cart');

export interface AddBatchInput {
  batchId: number;
}

export interface BatchItemResult {
  saleId: number;
  temuUrl: string;
  added: boolean;
  error?: string;
}

export interface AddBatchResult {
  ok: boolean;
  batchId: number;
  added: number;
  failed: number;
  items: BatchItemResult[];
  cartUrl: string;
  error?: string;
}

export async function addBatchToCart(input: AddBatchInput): Promise<AddBatchResult> {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM temu_batches WHERE id = ?').get(input.batchId) as
    | { id: number; status: string }
    | undefined;

  if (!batch) {
    return emptyFail(input.batchId, 'Batch not found');
  }
  if (batch.status !== 'open') {
    return emptyFail(input.batchId, `Batch state is "${batch.status}", expected "open"`);
  }

  // Mark as adding so nothing else races.
  db.prepare(
    `UPDATE temu_batches SET status = 'adding', started_at = datetime('now') WHERE id = ?`,
  ).run(input.batchId);

  // Load all queued sales for this batch.
  const items = db
    .prepare(
      `SELECT t.id        AS temu_order_id_pk,
              t.sale_id,
              s.listing_id,
              l.temu_url,
              l.temu_variant,
              l.title
         FROM temu_orders t
         JOIN sales    s ON s.id = t.sale_id
         JOIN listings l ON l.id = s.listing_id
        WHERE t.batch_id = ?
          AND t.state = 'queued'`,
    )
    .all(input.batchId) as Array<{
    temu_order_id_pk: number;
    sale_id: number;
    listing_id: number;
    temu_url: string | null;
    temu_variant: string | null;
    title: string;
  }>;

  if (items.length === 0) {
    db.prepare(
      `UPDATE temu_batches SET status = 'failed', last_error = 'No items to add' WHERE id = ?`,
    ).run(input.batchId);
    return emptyFail(input.batchId, 'Batch contains no queued items');
  }

  const mb = await getTemuBrowser();
  const page = await mb.context.newPage();
  const results: BatchItemResult[] = [];

  try {
    await requireLogin(page);

    for (const item of items) {
      if (!item.temu_url) {
        results.push({
          saleId: item.sale_id,
          temuUrl: '',
          added: false,
          error: 'Listing has no Temu URL',
        });
        markItemFailed(item.temu_order_id_pk, 'Listing has no Temu URL');
        continue;
      }

      const variant: TemuVariant | null = item.temu_variant
        ? (JSON.parse(item.temu_variant) as TemuVariant)
        : null;

      const res = await addOneToCart(page, {
        saleId: item.sale_id,
        temuUrl: item.temu_url,
        variant,
        title: item.title,
      });
      results.push(res);

      if (res.added) {
        db.prepare(
          `UPDATE temu_orders SET state = 'in_cart' WHERE id = ?`,
        ).run(item.temu_order_id_pk);
      } else {
        markItemFailed(item.temu_order_id_pk, res.error ?? 'unknown error');
      }

      // Pace requests: Temu rate-limits aggressively.
      await page.waitForTimeout(2_000 + Math.random() * 1_500);
    }
  } finally {
    await page.close();
  }

  const addedCount = results.filter((r) => r.added).length;
  const failedCount = results.length - addedCount;

  db.prepare(
    `UPDATE temu_batches
       SET status = ?, cart_ready_at = datetime('now'), sale_count = ?, last_error = ?
     WHERE id = ?`,
  ).run(
    failedCount === items.length ? 'failed' : 'cart_ready',
    addedCount,
    failedCount > 0 ? `${failedCount}/${items.length} items failed` : null,
    input.batchId,
  );

  log.info('Batch processed', { batchId: input.batchId, added: addedCount, failed: failedCount });

  return {
    ok: addedCount > 0,
    batchId: input.batchId,
    added: addedCount,
    failed: failedCount,
    items: results,
    cartUrl: TEMU.cartUrl,
  };
}

interface OneItemInput {
  saleId: number;
  temuUrl: string;
  variant: TemuVariant | null;
  title: string;
}

async function addOneToCart(page: Page, item: OneItemInput): Promise<BatchItemResult> {
  const base: BatchItemResult = { saleId: item.saleId, temuUrl: item.temuUrl, added: false };
  try {
    await page.goto(item.temuUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    if ((await isBotBlocked(page)).blocked) {
      return { ...base, error: 'Bot-block / captcha on product page' };
    }

    if (item.variant?.size) {
      const clicked = await clickSize(page, item.variant.size);
      if (!clicked) {
        return { ...base, error: `Size "${item.variant.size}" not available` };
      }
    }

    // Prefer "In den Warenkorb" — we do NOT want "Jetzt kaufen" here, because
    // Buy-Now skips the cart and goes straight to checkout.
    const cartBtn = page.locator(TEMU.addToCartButton).first();
    if ((await cartBtn.count()) === 0) {
      return { ...base, error: 'Add-to-cart button not found' };
    }
    await cartBtn.click({ timeout: 10_000 });

    // Temu often shows "Zum Warenkorb hinzugefügt" toast or a recommended-items
    // modal. Wait briefly then dismiss any modal by pressing Escape.
    await page.waitForTimeout(1_500);
    await page.keyboard.press('Escape').catch(() => {
      /* non-fatal */
    });

    return { ...base, added: true };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

async function clickSize(page: Page, size: string): Promise<boolean> {
  const selector = TEMU.sizeButton(size);
  const btn = page.locator(selector).first();
  if ((await btn.count()) === 0) return false;
  await btn.click({ timeout: 5_000 });
  await page.waitForTimeout(500);
  return true;
}

function markItemFailed(temuOrderId: number, error: string): void {
  getDb()
    .prepare(
      `UPDATE temu_orders SET state = 'failed', last_error = ? WHERE id = ?`,
    )
    .run(error, temuOrderId);
}

function emptyFail(batchId: number, error: string): AddBatchResult {
  return {
    ok: false,
    batchId,
    added: 0,
    failed: 0,
    items: [],
    cartUrl: TEMU.cartUrl,
    error,
  };
}

/**
 * Build a fresh "open" batch from all paid sales without Temu orders placed yet.
 * Creates `temu_orders` rows (state='queued') linking them to the batch.
 *
 * Returns the batch + the number of sales enqueued.
 */
export function buildOpenBatch(windowHours: number): { batchId: number; saleCount: number } {
  const db = getDb();

  // Eligible sales: paid within window, not already in any non-failed batch.
  const eligible = db
    .prepare(
      `SELECT s.id AS sale_id
         FROM sales s
         JOIN listings l ON l.id = s.listing_id
        WHERE s.paid_at IS NOT NULL
          AND s.paid_at > datetime('now', ?)
          AND l.temu_url IS NOT NULL
          AND l.dry_run = 0
          AND NOT EXISTS (
            SELECT 1 FROM temu_orders t
             WHERE t.sale_id = s.id AND t.state NOT IN ('failed','cancelled')
          )`,
    )
    .all(`-${windowHours} hours`) as Array<{ sale_id: number }>;

  const insertBatch = db
    .prepare(
      `INSERT INTO temu_batches (window_hours, status, sale_count)
       VALUES (?, 'open', ?)`,
    )
    .run(windowHours, eligible.length);
  const batchId = insertBatch.lastInsertRowid as number;

  const insertOrder = db.prepare(
    `INSERT INTO temu_orders (sale_id, batch_id, state, idempotency_key)
     VALUES (?, ?, 'queued', ?)`,
  );

  const tx = db.transaction(() => {
    for (const row of eligible) {
      insertOrder.run(row.sale_id, batchId, `sale-${row.sale_id}`);
    }
  });
  tx();

  return { batchId, saleCount: eligible.length };
}
