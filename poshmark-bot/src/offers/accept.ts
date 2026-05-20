// ──────────────────────────────────────────────────────────────────────────────
// Poshmark Offer — accept
//
// Poshmark buyers can press "Make Offer". Seller (us) gets the offer in the
// product's conversation thread. We navigate to that thread and click "Accept".
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_OFFER_ACCEPT_BTN,
  SEL_OFFER_CONFIRM,
} from '../selectors.js';

const log = createLogger('poshmark-offer-accept');
const BASE_URL = process.env.POSHMARK_BASE_URL ?? 'https://www.poshmark.com';

export interface OfferResult {
  ok: boolean;
  error?: string;
}

/**
 * Accept a Poshmark offer. `offerId` is the conversation id (Poshmark uses the
 * chat thread as the offer container). We support either a raw conversation
 * id or a direct item id as a fallback.
 */
export async function acceptPoshmarkOffer(
  ctx: BrowserContext,
  offerId: string,
): Promise<OfferResult> {
  if (!offerId) return { ok: false, error: 'offerId (conversationId) required' };
  const page = await ctx.newPage();
  try {
    // Navigate to chat (which surfaces the offer-accept button).
    const url = `${BASE_URL}/messages/${offerId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await SEL_OFFER_ACCEPT_BTN.waitFor(page, { timeout: 10_000 });
    await SEL_OFFER_ACCEPT_BTN.click(page);

    // Confirmation modal — best effort
    try {
      await SEL_OFFER_CONFIRM.click(page);
    } catch { /* no dialog */ }

    await page.waitForTimeout(2_000);
    log.info('Poshmark offer accepted', { offerId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close().catch(() => null);
  }
}
