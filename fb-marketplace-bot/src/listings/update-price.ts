// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — update price for an existing listing.
//
// HIGH-RISK: edits trigger anti-bot signals. We use long randomised delays.
// Strategy: open /marketplace/item/<id>/edit, fill price, click Save.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger, type UpdatePriceResult } from '@vinted-system/shared';
import {
  SEL_PRICE_EDIT_INPUT,
  SEL_SAVE_BTN,
  SEL_EDIT_BTN,
  SEL_LOGGED_IN,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-update-price');
const BASE_URL = 'https://www.facebook.com';

function jitter(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

function itemEditUrl(input: string): string {
  if (!input) return '';
  if (input.startsWith('http')) {
    return input.includes('/edit') ? input : `${input}/edit`;
  }
  // numeric FB item id
  if (/^\d+$/.test(input)) return `${BASE_URL}/marketplace/item/${input}/edit`;
  return `${BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
}

export async function updateFbListingPrice(
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
    await page.waitForTimeout(jitter(3000, 5000)); // long delay — FB hates fast bots

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, error: 'FB checkpoint hit' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha' };

    // Try edit-button if we landed on the listing page rather than edit form.
    if (!(await SEL_PRICE_EDIT_INPUT.exists(page))) {
      try { await SEL_EDIT_BTN.click(page); } catch { /* ignore */ }
      await page.waitForTimeout(jitter(2000, 3500));
    }

    const input = await SEL_PRICE_EDIT_INPUT.resolve(page);
    await input.click({ clickCount: 3 });
    await page.waitForTimeout(jitter(300, 700));
    await input.fill(String(Math.round(newPriceEur)));
    await page.waitForTimeout(jitter(800, 1500));

    await SEL_SAVE_BTN.click(page);
    await page.waitForTimeout(jitter(2500, 4000));

    log.info('FB price updated', { externalIdOrUrl, newPriceEur });
    return { ok: true, newPriceEur };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('FB price update failed', { externalIdOrUrl, error });
    return { ok: false, error };
  }
}
