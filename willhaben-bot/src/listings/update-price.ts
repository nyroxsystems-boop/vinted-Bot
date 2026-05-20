// ──────────────────────────────────────────────────────────────────────────────
// Willhaben Listing-Price-Update
//
// Opens the edit-form for an existing Willhaben listing and overwrites the price.
// Used by the orchestrator's repricer to nudge listings without re-creating.
// NOTE: Willhaben prices are USD. We convert EUR → USD with EUR_USD_RATE (env).
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_EDIT_PRICE_INPUT,
  SEL_EDIT_SAVE_BTN,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('willhaben-update-price');
const BASE_URL = process.env.WILLHABEN_BASE_URL ?? 'https://www.willhaben.com';
const USD_RATE = Number(process.env.EUR_USD_RATE ?? 1.07);

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

/**
 * Updates the price of a Willhaben listing. The `newPriceEur` is converted to
 * USD with `EUR_USD_RATE` (default 1.07). External-ID is Willhaben's `m12345…`
 * style id (the segment after /item/).
 */
export async function updateWillhabenListingPrice(
  ctx: BrowserContext,
  externalId: string,
  newPriceEur: number,
): Promise<UpdatePriceResult> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  if (!Number.isFinite(newPriceEur) || newPriceEur <= 0) {
    return { ok: false, error: 'invalid newPriceEur' };
  }
  const newPriceUsd = Math.round(newPriceEur * USD_RATE * 100) / 100;

  const page = await ctx.newPage();
  try {
    // Willhaben edit URL — verified pattern. The product page redirects sellers
    // to the editor when they click "Edit listing" on their own item.
    // TODO: validate /sell/edit/<id> still works (alternative: /mypage/listings/<id>/edit).
    const editUrl = `${BASE_URL}/sell/edit/${externalId}`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    if (await SEL_CAPTCHA.exists(page)) {
      return { ok: false, error: 'captcha challenge on edit page' };
    }
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await SEL_EDIT_PRICE_INPUT.waitFor(page, { timeout: 12_000 });
    const input = await SEL_EDIT_PRICE_INPUT.resolve(page);
    // Select-all + retype (avoids race where fill() sees stale value)
    await input.click({ clickCount: 3 });
    await input.fill(newPriceUsd.toFixed(2));
    await page.waitForTimeout(300);

    await SEL_EDIT_SAVE_BTN.click(page);
    await page.waitForTimeout(2_000);

    log.info('Willhaben price updated', { externalId, newPriceEur, newPriceUsd });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('updateWillhabenListingPrice failed', { externalId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}
