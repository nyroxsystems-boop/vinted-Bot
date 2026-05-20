// ──────────────────────────────────────────────────────────────────────────────
// Grailed listing price update — opens the edit page for an existing
// listing and overwrites the price.
//
// Grailed URL pattern: /listings/{listingId}/edit
// Grailed sells in USD; we get an EUR price and convert.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, cloudflareSafeNavigate } from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-update-price');

const EUR_TO_USD = Number(process.env.EUR_USD_RATE ?? 1.08);

// TODO: validate selectors against live site.
const PRICE_INPUT = [
  'input[name="price"]',
  'input[name*="price" i]',
  'input[placeholder*="price" i]',
  'input[id*="price" i]',
].join(', ');

const SAVE_BUTTON = [
  'button:has-text("Save")',
  'button:has-text("Update")',
  'button:has-text("Save changes")',
  'button:has-text("Publish")',
  'button[type="submit"]',
].join(', ');

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

export async function updateListingPrice(
  externalId: string,
  newPriceEur: number,
  accountId: number,
): Promise<UpdatePriceResult> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  if (!Number.isFinite(newPriceEur) || newPriceEur <= 0) {
    return { ok: false, error: 'invalid newPriceEur' };
  }
  const newPriceUsd = Math.round(newPriceEur * EUR_TO_USD);

  const ctx = await launchGrailed(accountId, false);
  const page = await ctx.newPage();
  try {
    // CF-safe home visit first to pre-warm cookies.
    const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 25_000 });
    if (!home.ok) return { ok: false, error: home.error };

    if (!(await isGrailedLoggedIn(page))) {
      return { ok: false, error: 'not authenticated — run /api/auth/login first' };
    }

    const editUrl = `${GRAILED_BASE_URL}/listings/${externalId}/edit`;
    const nav = await cloudflareSafeNavigate(page, editUrl, { timeoutMs: 30_000 });
    if (!nav.ok) return { ok: false, error: nav.error };
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

    const input = page.locator(PRICE_INPUT).first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.click({ clickCount: 3 });
    await input.fill(String(newPriceUsd));
    await page.waitForTimeout(400);

    const save = page.locator(SAVE_BUTTON).first();
    await save.click({ timeout: 8_000 });
    await page.waitForTimeout(2_500);

    log.info('Grailed listing price updated', { externalId, newPriceEur, newPriceUsd });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Grailed price update failed', { externalId, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
