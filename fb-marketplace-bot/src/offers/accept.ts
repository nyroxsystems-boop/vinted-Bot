// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — accept buyer offer.
//
// FB Marketplace offers appear inline in the conversation thread. Buyer clicks
// "Make offer", seller sees Accept/Decline buttons. Long jittered delays to
// avoid anti-bot triggers.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_OFFER_ACCEPT,
  SEL_LOGGED_IN,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-offer-accept');
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

export async function acceptFbOffer(
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

    if (!(await SEL_OFFER_ACCEPT.exists(page))) {
      return { ok: false, error: 'accept button not found — offer may have expired or none present' };
    }
    await SEL_OFFER_ACCEPT.click(page);
    await page.waitForTimeout(jitter(1500, 2500));

    // Confirm modal best-effort
    const confirm = page.locator(
      'div[aria-label="Bestätigen"][role="button"], div[aria-label="Confirm"][role="button"], button:has-text("Bestätigen"), button:has-text("Confirm")',
    ).first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(jitter(1500, 2500));
    }

    log.info('FB offer accepted', { offerOrConversationId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
