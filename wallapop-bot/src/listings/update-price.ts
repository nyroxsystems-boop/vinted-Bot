// ──────────────────────────────────────────────────────────────────────────────
// Wallapop Listing-Price-Update
//
// Opens the edit-form for an existing Wallapop listing and overwrites the
// price. Used by the orchestrator's repricer to nudge listings without
// re-creating them.
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_EDIT_PRICE_INPUT,
  SEL_EDIT_SAVE_BTN,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('wp-update-price');
const BASE_URL = process.env.WALLAPOP_BASE_URL ?? 'https://es.wallapop.com';

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

/**
 * Updates the price of a Wallapop listing. `newPriceEur` is the new sale
 * price in EUR. `externalId` is Wallapop's item id (the segment after /item/).
 */
export async function updateWallapopListingPrice(
  ctx: BrowserContext,
  externalId: string,
  newPriceEur: number,
): Promise<UpdatePriceResult> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  if (!Number.isFinite(newPriceEur) || newPriceEur <= 0) {
    return { ok: false, error: 'invalid newPriceEur' };
  }

  const page = await ctx.newPage();
  try {
    // Wallapop edit-listing URL candidates — try in order, pick the first
    // that responds with our form. TODO: validate live.
    const editCandidates = [
      `${BASE_URL}/app/upload/edit/${externalId}`,
      `${BASE_URL}/upload/edit/${externalId}`,
      `${BASE_URL}/item/${externalId}/edit`,
    ];

    let landed = false;
    for (const url of editCandidates) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => null);
      if (await SEL_CAPTCHA.exists(page)) {
        return { ok: false, error: 'captcha challenge on edit page' };
      }
      if (await SEL_EDIT_PRICE_INPUT.exists(page)) {
        landed = true;
        break;
      }
    }
    if (!landed) return { ok: false, error: 'edit page not reachable — selector drift or auth fail' };

    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    const input = await SEL_EDIT_PRICE_INPUT.resolve(page);
    await input.click({ clickCount: 3 });
    // Wallapop is Spain-EU — decimal separator is comma but inputs usually
    // accept dot. Use dot for safety.
    await input.fill(newPriceEur.toFixed(2));
    await page.waitForTimeout(300);

    await SEL_EDIT_SAVE_BTN.click(page);
    await page.waitForTimeout(2_000);

    log.info('Wallapop price updated', { externalId, newPriceEur });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('updateWallapopListingPrice failed', { externalId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
  }
}
