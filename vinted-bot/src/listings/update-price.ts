// ──────────────────────────────────────────────────────────────────────────────
// Listing price update — opens the edit page for an existing Vinted listing
// and overwrites the price. Used by the refresher to trigger the
// "Preis gesenkt"-badge without having to re-create the listing.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '@vinted-system/shared';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { LISTING_SELECTORS } from './selectors.js';

// Edit-mode submit button: Vinted's edit page uses "Speichern" / "Save"
// instead of "Hochladen". Fall back to the create-form submit selector
// if neither is found.
const EDIT_SAVE_BUTTON = [
  'button:has-text("Änderungen speichern")',
  'button:has-text("Speichern")',
  'button:has-text("Save")',
  'button:has-text("Aktualisieren")',
  'button[type="submit"]',
].join(', ');

const log = createLogger('vinted-update-price');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

export async function updateListingPrice(
  vintedItemId: string,
  newPrice: number,
  accountId: number,
): Promise<UpdatePriceResult> {
  if (!vintedItemId) return { ok: false, error: 'vintedItemId required' };

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  try {
    await requireLogin(page, accountId);
    await page.goto(`${BASE_URL}/items/${vintedItemId}/edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    const input = page.locator(LISTING_SELECTORS.priceInput).first();
    await input.waitFor({ state: 'visible', timeout: 8_000 });
    await input.click({ clickCount: 3 }); // select all
    const priceStr = newPrice.toFixed(2).replace('.', ',');
    await input.fill(priceStr);
    await page.waitForTimeout(300);

    const submit = page.locator(EDIT_SAVE_BUTTON).first();
    await submit.click({ timeout: 5_000 });
    await page.waitForTimeout(2_000);

    log.info('Listing price updated', { vintedItemId, newPrice });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Price update failed', { vintedItemId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}
