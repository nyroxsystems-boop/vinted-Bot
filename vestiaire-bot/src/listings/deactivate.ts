// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — deactivate / take offline a listing.
// Strategy: open item edit-page, click "Offline" or "Unpublish" or "Delete".
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import {
  SEL_ITEM_OFFLINE,
  SEL_CONFIRM_DELETE,
  SEL_LOGGED_IN,
} from '../selectors.js';

const log = createLogger('vc-deactivate');
const BASE_URL = 'https://www.vestiairecollective.com';

function itemUrl(input: string): string {
  if (input.startsWith('http')) return input;
  return `${BASE_URL}/sell/item/${input}`;
}

export async function deactivateVestiaireListing(
  page: Page,
  externalIdOrUrl: string,
): Promise<DeactivateResult> {
  if (!externalIdOrUrl) return { ok: false, error: 'externalId/url required' };

  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }
    await page.goto(itemUrl(externalIdOrUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);

    // TODO: validate — selector for "Offline"/"Unpublish" button.
    try {
      await SEL_ITEM_OFFLINE.click(page);
      await page.waitForTimeout(800);
    } catch (err) {
      return { ok: false, error: `offline-button not found: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Confirm dialog if present
    try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe no confirm */ }
    await page.waitForTimeout(1200);

    log.info('Vestiaire listing deactivated', { externalIdOrUrl });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
