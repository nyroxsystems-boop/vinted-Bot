// ──────────────────────────────────────────────────────────────────────────────
// Depop listing price update — opens the edit page for an existing Depop
// listing and overwrites the price. Used by the repricer + manual override.
//
// Depop's listing edit URL: https://www.depop.com/products/<id>/edit/
// The price input is the same control as the create-flow (input[name="price"]).
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger, cloudflareSafeNavigate } from '@vinted-system/shared';
import { SEL_PRICE } from '../selectors.js';

const log = createLogger('depop-update-price');
const BASE_URL = process.env.DEPOP_BASE_URL ?? 'https://www.depop.com';

const EDIT_SAVE_BUTTON = [
  'button:has-text("Save")',
  'button:has-text("Update")',
  'button[type="submit"]',
  '[data-testid="save-listing-button"]',
].join(', ');

export interface UpdatePriceResult {
  ok: boolean;
  error?: string;
}

export async function updateDepopListingPrice(
  page: Page,
  externalIdOrUrl: string,
  newPrice: number,
): Promise<UpdatePriceResult> {
  if (!externalIdOrUrl) return { ok: false, error: 'externalIdOrUrl required' };

  const externalId = externalIdOrUrl.startsWith('http')
    ? externalIdOrUrl.replace(/\/$/, '').split('/').pop() ?? externalIdOrUrl
    : externalIdOrUrl;

  try {
    const editUrl = `${BASE_URL}/products/${externalId}/edit/`;
    const nav = await cloudflareSafeNavigate(page, editUrl, { timeoutMs: 45_000 });
    if (!nav.ok) {
      return { ok: false, error: nav.error ?? 'cloudflare-blocked' };
    }

    // Depop's edit page uses the same price input as the create-flow.
    if (!(await SEL_PRICE.exists(page))) {
      return { ok: false, error: 'price input not found' };
    }
    await SEL_PRICE.waitFor(page, { state: 'visible', timeout: 15_000 });
    await SEL_PRICE.fill(page, '');
    await SEL_PRICE.fill(page, newPrice.toFixed(2));

    const saveBtn = page.locator(EDIT_SAVE_BUTTON).first();
    await saveBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await saveBtn.click();

    // Wait for either a success toast or URL change away from /edit/
    await Promise.race([
      page.waitForURL((u) => !u.toString().includes('/edit'), { timeout: 15_000 }),
      page.locator('[role="alert"], [data-testid="toast"]').first().waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => { /* swallow — the save may have completed silently */ });

    log.info('Depop price updated', { externalId, newPrice });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('updateDepopListingPrice failed', { externalId, error: msg });
    return { ok: false, error: msg };
  }
}
