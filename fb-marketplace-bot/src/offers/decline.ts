// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — decline buyer offer.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_OFFER_DECLINE,
  SEL_LOGGED_IN,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-offer-decline');
const BASE_URL = 'https://www.facebook.com';

function jitter(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

export interface OfferActionResult {
  ok: boolean;
  error?: string;
}

function conversationUrl(idOrUrl: string): string {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `${BASE_URL}/marketplace/t/${encodeURIComponent(idOrUrl)}/`;
}

export async function declineFbOffer(
  page: Page,
  offerOrConversationId: string,
): Promise<OfferActionResult> {
  if (!offerOrConversationId) return { ok: false, error: 'id required' };

  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }
    await page.goto(conversationUrl(offerOrConversationId), {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    await page.waitForTimeout(jitter(2500, 4500));

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, error: 'FB checkpoint' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha' };

    if (!(await SEL_OFFER_DECLINE.exists(page))) {
      return { ok: false, error: 'decline button not found' };
    }
    await SEL_OFFER_DECLINE.click(page);
    await page.waitForTimeout(jitter(1500, 2500));

    log.info('FB offer declined', { offerOrConversationId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
