import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import { SEL_ITEM_DELETE_BTN, SEL_CONFIRM_DELETE, SEL_ITEM_RESERVE_BTN } from '../selectors.js';

const log = createLogger('wp-listing-deactivate');

const BASE = 'https://es.wallapop.com';

export async function deactivateWallapopListing(
  page: Page,
  externalIdOrUrl: string,
  opts: { mode?: 'reserve' | 'delete' } = {},
): Promise<DeactivateResult> {
  const url = externalIdOrUrl.startsWith('http')
    ? externalIdOrUrl
    : `${BASE}/item/${externalIdOrUrl}`;
  const mode = opts.mode ?? 'reserve';

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (mode === 'reserve') {
      try {
        await SEL_ITEM_RESERVE_BTN.click(page);
        await page.waitForTimeout(500);
        log.info('Wallapop reserved', { externalIdOrUrl });
        return { ok: true };
      } catch {
        log.warn('reserve not available, falling through to delete');
      }
    }

    try {
      await SEL_ITEM_DELETE_BTN.click(page);
      await page.waitForTimeout(400);
      try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe none */ }
      await page.waitForTimeout(500);
      log.info('Wallapop deleted', { externalIdOrUrl });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `neither reserve nor delete: ${err instanceof Error ? err.message : String(err)}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
