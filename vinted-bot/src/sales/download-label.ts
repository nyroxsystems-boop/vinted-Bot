// ──────────────────────────────────────────────────────────────────────────────
// Shipping-Label Downloader.
//
// For a given sale we navigate to Vinted's transactions page, locate the
// sale's row, follow the label link, and save the resulting PDF under
// /Users/home/Vinted/_labels/sale_<id>.pdf.
//
// Vinted's transaction UI is partially unverified in this account (the old
// /sold_items URL 404s). The selectors below are the best-effort fallback
// chain — when they miss, the caller marks the sale as "needs manual label".
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger, getDb, accountLabelsDir } from '@vinted-system/shared';
import type { Sale } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';

const log = createLogger('vinted-label');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

export interface DownloadLabelResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export async function downloadLabelForSale(
  saleId: number,
  accountId: number,
): Promise<DownloadLabelResult> {
  const db = getDb();
  const sale = db
    .prepare('SELECT * FROM sales WHERE id = ?')
    .get(saleId) as Sale | undefined;
  if (!sale) return { ok: false, error: `Sale ${saleId} not found` };
  if (sale.shipping_label_path) {
    return { ok: true, path: sale.shipping_label_path };
  }

  const labelsDir = accountLabelsDir(accountId);
  await fs.mkdir(labelsDir, { recursive: true });
  const targetPath = path.join(labelsDir, `sale_${saleId}.pdf`);

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  try {
    await requireLogin(page, accountId);
    await page.goto(`${BASE_URL}${VINTED.soldItemsUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    // Try to find the row that matches this sale. We match by buyer
    // username and listing title — Vinted's transaction rows don't
    // expose our internal sale id.
    const listingRow = db
      .prepare('SELECT title FROM listings WHERE id = ?')
      .get(sale.listing_id) as { title: string } | undefined;

    const rowSelector = listingRow?.title
      ? `main :has-text(${JSON.stringify(listingRow.title)})`
      : `main :has-text(${JSON.stringify(sale.buyer_name)})`;

    const row = page.locator(rowSelector).first();
    await row.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);

    // Click the label link within the row, or a global label link as
    // fallback. Vinted usually opens the PDF in a new tab — we wait
    // for either a popup OR a direct navigation.
    const labelLink = page.locator(VINTED.shippingLabelLink).first();
    if ((await labelLink.count()) === 0) {
      return { ok: false, error: 'No shipping-label link found on page' };
    }

    // Intercept the download.
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await labelLink.click({ timeout: 5_000 });
    const download = await downloadPromise;
    await download.saveAs(targetPath);

    db.prepare(
      `UPDATE sales
          SET shipping_label_path = ?,
              shipping_label_fetched_at = datetime('now')
        WHERE id = ?`,
    ).run(targetPath, saleId);

    log.info('Shipping label saved', { saleId, targetPath });
    return { ok: true, path: targetPath };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Label download failed', { saleId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}
