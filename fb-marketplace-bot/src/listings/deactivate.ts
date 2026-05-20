// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — deactivate listing.
//
// HIGH-RISK: FB has been known to disable accounts for rapid mark-as-sold/
// delete operations. Use sparingly with long human-like delays.
// Default mode: 'mark-sold' (reversible). Fallback: 'delete'.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger, type DeactivateResult } from '@vinted-system/shared';
import {
  SEL_MARK_SOLD,
  SEL_DELETE_BTN,
  SEL_CONFIRM_DELETE,
  SEL_LOGGED_IN,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-deactivate');
const BASE_URL = 'https://www.facebook.com';

function jitter(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

function itemUrl(input: string): string {
  if (input.startsWith('http')) return input;
  if (/^\d+$/.test(input)) return `${BASE_URL}/marketplace/item/${input}`;
  return `${BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
}

export async function deactivateFbListing(
  page: Page,
  externalIdOrUrl: string,
  opts: { mode?: 'mark-sold' | 'delete' } = {},
): Promise<DeactivateResult> {
  const mode = opts.mode ?? 'mark-sold';
  if (!externalIdOrUrl) return { ok: false, error: 'externalId/url required' };

  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, error: 'not authenticated' };
    }
    await page.goto(itemUrl(externalIdOrUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(jitter(3000, 5000)); // long delay

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, error: 'FB checkpoint hit' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, error: 'captcha' };

    if (mode === 'mark-sold') {
      try {
        await SEL_MARK_SOLD.click(page);
        await page.waitForTimeout(jitter(1500, 2500));
        log.info('FB listing marked as sold', { externalIdOrUrl });
        return { ok: true };
      } catch (err) {
        log.warn('mark-sold not available, falling through to delete', {
          externalIdOrUrl,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      await SEL_DELETE_BTN.click(page);
      await page.waitForTimeout(jitter(1000, 2000));
      try { await SEL_CONFIRM_DELETE.click(page); } catch { /* maybe no confirm */ }
      await page.waitForTimeout(jitter(1500, 2500));
      log.info('FB listing deleted', { externalIdOrUrl });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `neither mark-sold nor delete worked: ${err instanceof Error ? err.message : String(err)}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
