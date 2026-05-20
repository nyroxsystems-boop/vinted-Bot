// Depop Listing löschen — Depop hat kein "hide", nur Delete.
import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import { SEL_ITEM_DELETE_BTN, SEL_CONFIRM_DELETE } from '../selectors.js';

const log = createLogger('depop-listing-deactivate');

const BASE = 'https://www.depop.com';

export async function deactivateDepopListing(
  page: Page,
  externalIdOrUrl: string,
): Promise<DeactivateResult> {
  const url = externalIdOrUrl.startsWith('http')
    ? externalIdOrUrl
    : `${BASE}/products/${externalIdOrUrl}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await SEL_ITEM_DELETE_BTN.click(page);
    await page.waitForTimeout(400);
    try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe none */ }
    await page.waitForTimeout(500);
    log.info('Depop listing deleted', { externalIdOrUrl });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
