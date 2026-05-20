// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — update price for an existing listing.
//
// Vestiaire stores listings under /<lang>/item/<slug>-<id>.shtml.
// The edit page can be opened via the seller-area "My items" → "Edit".
// We support both raw URL and bare external_id (the trailing number).
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger, type UpdatePriceResult } from '@vinted-system/shared';
import {
  SEL_PRICE_EDIT_INPUT,
  SEL_SAVE_BTN,
  SEL_ITEM_EDIT,
  SEL_LOGGED_IN,
} from '../selectors.js';

const log = createLogger('vc-update-price');
const BASE_URL = 'https://www.vestiairecollective.com';

function itemEditUrl(input: string): string {
  if (!input) return '';
  if (input.startsWith('http')) {
    // Try to convert /item/...shtml → edit page
    return input.includes('/edit') ? input : `${input}/edit`;
  }
  // numeric id → /sell/item/<id>/edit (best-guess, falls back to /member/items)
  return `${BASE_URL}/sell/item/${input}/edit`;
}

export async function updateVestiaireListingPrice(
  page: Page,
  externalIdOrUrl: string,
  newPriceEur: number,
): Promise<UpdatePriceResult> {
  if (!externalIdOrUrl) return { ok: false, error: 'externalId/url required' };
  if (!Number.isFinite(newPriceEur) || newPriceEur <= 0) {
    return { ok: false, error: 'invalid price' };
  }

  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await page.goto(itemEditUrl(externalIdOrUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);

    // TODO: validate — Vestiaire may need to click an "Edit" link from a list page first.
    if (!(await SEL_PRICE_EDIT_INPUT.exists(page))) {
      // Try opening edit via item-page edit button
      try { await SEL_ITEM_EDIT.click(page); } catch { /* ignore */ }
      await page.waitForTimeout(1500);
    }

    const input = await SEL_PRICE_EDIT_INPUT.resolve(page);
    await input.click({ clickCount: 3 });
    await input.fill(String(Math.round(newPriceEur)));
    await page.waitForTimeout(400);

    await SEL_SAVE_BTN.click(page);
    await page.waitForTimeout(2000);

    log.info('Price updated', { externalIdOrUrl, newPriceEur });
    return { ok: true, newPriceEur };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Price update failed', { externalIdOrUrl, error });
    return { ok: false, error };
  }
}
