// ──────────────────────────────────────────────────────────────────────────────
// Wallapop Offer — accept
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_OFFER_ACCEPT_BTN,
  SEL_OFFER_CONFIRM,
} from '../selectors.js';

const log = createLogger('wp-offer-accept');
const BASE_URL = process.env.WALLAPOP_BASE_URL ?? 'https://es.wallapop.com';

export interface OfferResult {
  ok: boolean;
  error?: string;
}

/**
 * Accept a Wallapop offer. `offerId` is the conversation id (Wallapop renders
 * offers inside the per-product chat thread).
 */
export async function acceptWallapopOffer(
  ctx: BrowserContext,
  offerId: string,
): Promise<OfferResult> {
  if (!offerId) return { ok: false, error: 'offerId (conversationId) required' };
  const page = await ctx.newPage();
  try {
    const url = `${BASE_URL}/chat/${offerId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await SEL_OFFER_ACCEPT_BTN.waitFor(page, { timeout: 10_000 });
    await SEL_OFFER_ACCEPT_BTN.click(page);

    try {
      await SEL_OFFER_CONFIRM.click(page);
    } catch { /* no dialog */ }

    await page.waitForTimeout(2_000);
    log.info('Wallapop offer accepted', { offerId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close().catch(() => null);
  }
}
