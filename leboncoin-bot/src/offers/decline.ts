// ──────────────────────────────────────────────────────────────────────────────
// Leboncoin Offer — decline
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_OFFER_DECLINE_BTN,
  SEL_OFFER_CONFIRM,
} from '../selectors.js';

const log = createLogger('leboncoin-offer-decline');
const BASE_URL = process.env.LEBONCOIN_BASE_URL ?? 'https://www.leboncoin.com';

export interface OfferResult {
  ok: boolean;
  error?: string;
}

export async function declineLeboncoinOffer(
  ctx: BrowserContext,
  offerId: string,
): Promise<OfferResult> {
  if (!offerId) return { ok: false, error: 'offerId (conversationId) required' };
  const page = await ctx.newPage();
  try {
    const url = `${BASE_URL}/messages/${offerId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await SEL_OFFER_DECLINE_BTN.waitFor(page, { timeout: 10_000 });
    await SEL_OFFER_DECLINE_BTN.click(page);

    try {
      await SEL_OFFER_CONFIRM.click(page);
    } catch { /* no dialog */ }

    await page.waitForTimeout(1_500);
    log.info('Leboncoin offer declined', { offerId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close().catch(() => null);
  }
}
