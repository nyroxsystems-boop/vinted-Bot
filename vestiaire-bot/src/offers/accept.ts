// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — accept incoming offer.
//
// Vestiaire has a "Make an offer" feature on luxury items. Accept/Decline
// buttons appear inline in the conversation thread.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_OFFER_ACCEPT,
  SEL_LOGGED_IN,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('vc-offer-accept');
const BASE_URL = 'https://www.vestiairecollective.com';

export interface OfferActionResult {
  ok: boolean;
  error?: string;
}

function conversationUrl(idOrUrl: string): string {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `${BASE_URL}/conversation/${encodeURIComponent(idOrUrl)}`;
}

export async function acceptVestiaireOffer(
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
    await page.waitForTimeout(1500);

    if (await SEL_BLOCKED.exists(page)) return { ok: false, error: 'blocked' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha' };

    if (!(await SEL_OFFER_ACCEPT.exists(page))) {
      return { ok: false, error: 'accept button not found — offer may have expired' };
    }
    await SEL_OFFER_ACCEPT.click(page);
    await page.waitForTimeout(1500);

    // Best-effort confirm modal
    const confirm = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5000 }).catch(() => null);
    }
    await page.waitForTimeout(1500);

    log.info('Offer accepted', { offerOrConversationId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
