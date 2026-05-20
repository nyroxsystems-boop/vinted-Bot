// Poshmark Listing deaktivieren — über "Keep private" (versteckt aber nicht löscht)
// oder Fallback: Delete.
import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import {
  SEL_ITEM_EDIT_BTN,
  SEL_ITEM_KEEP_BTN,
  SEL_ITEM_DELETE_BTN,
  SEL_CONFIRM_DELETE,
} from '../selectors.js';

const log = createLogger('poshmark-listing-deactivate');

const BASE = 'https://www.poshmark.com';

export async function deactivatePoshmarkListing(
  page: Page,
  externalIdOrUrl: string,
  opts: { mode?: 'hide' | 'delete' } = {},
): Promise<DeactivateResult> {
  const url = externalIdOrUrl.startsWith('http')
    ? externalIdOrUrl
    : `${BASE}/item/${externalIdOrUrl}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Edit-Drawer öffnen
    try { await SEL_ITEM_EDIT_BTN.click(page); }
    catch (err) { return { ok: false, error: `edit-button: ${err instanceof Error ? err.message : String(err)}` }; }
    await page.waitForTimeout(500);

    if ((opts.mode ?? 'hide') === 'hide') {
      try {
        await SEL_ITEM_KEEP_BTN.click(page);
        await page.waitForTimeout(500);
        log.info('Poshmark listing hidden', { externalIdOrUrl });
        return { ok: true };
      } catch {
        log.warn('keep-private not available, falling through to delete');
      }
    }

    try {
      await SEL_ITEM_DELETE_BTN.click(page);
      await page.waitForTimeout(400);
      try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe no confirm */ }
      await page.waitForTimeout(500);
      log.info('Poshmark listing deleted', { externalIdOrUrl });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `neither hide nor delete: ${err instanceof Error ? err.message : String(err)}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
