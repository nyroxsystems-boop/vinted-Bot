// ──────────────────────────────────────────────────────────────────────────────
// Etsy listing price update — opens the edit page of an existing listing
// and overwrites the price. Used by repricers / re-listers.
//
// Etsy URL pattern: /your/shops/me/listings/{listingId}/edit
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import { launchEtsy, isEtsyLoggedIn, ETSY_BASE_URL } from '../browser.js';

const log = createLogger('etsy-update-price');

// TODO: validate selectors against live site.
const PRICE_INPUT = [
  'input[name="price"]',
  '#price-input',
  'input[id*="price" i]',
  'input[placeholder*="price" i]',
].join(', ');

const SAVE_BUTTON = [
  'button:has-text("Save")',
  'button:has-text("Publish")',
  'button:has-text("Save and close")',
  'button[type="submit"]',
].join(', ');

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

export async function updateListingPrice(
  externalId: string,
  newPrice: number,
  accountId: number,
): Promise<UpdatePriceResult> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { ok: false, error: 'invalid newPrice' };
  }

  const ctx = await launchEtsy(accountId, false);
  const page = await ctx.newPage();
  try {
    await page.goto(ETSY_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
    if (!(await isEtsyLoggedIn(page))) {
      return { ok: false, error: 'not authenticated — run /api/auth/login first' };
    }

    const editUrl = `${ETSY_BASE_URL}/your/shops/me/listings/${externalId}/edit`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    const input = page.locator(PRICE_INPUT).first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.click({ clickCount: 3 });
    // Etsy is USD by default — use a dot as decimal separator.
    await input.fill(newPrice.toFixed(2));
    await page.waitForTimeout(400);

    const save = page.locator(SAVE_BUTTON).first();
    await save.click({ timeout: 8_000 });
    await page.waitForTimeout(2_500);

    log.info('Etsy listing price updated', { externalId, newPrice });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Etsy price update failed', { externalId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
