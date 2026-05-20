// KA UpdatePrice — geht über Anzeige-Bearbeiten-Form
import type { Page } from 'playwright';
import { createLogger, retry, chain, type UpdatePriceResult } from '@vinted-system/shared';
import { launchKaBrowser } from '../browser.js';
import { isLoggedIn } from '../login-flow.js';
import { SEL_PRICE_INPUT } from '../selectors.js';

const log = createLogger('ka-update-price');

const SEL_EDIT_AD_BTN = chain('ka:edit-ad',
  'a[href*="/p-anzeige-bearbeiten"]',
  'a:has-text("Anzeige bearbeiten")',
  '[data-testid="edit-ad-button"]',
);

const SEL_SAVE_AD_BTN = chain('ka:save-ad',
  'button:has-text("Speichern")',
  'button[type="submit"]:has-text("Anzeige aktualisieren")',
  '#pstad-submit',
);

export async function updatePriceKleinanzeigen(
  accountId: number,
  dataRoot: string,
  externalIdOrUrl: string,
  newPriceEur: number,
): Promise<UpdatePriceResult> {
  const url = externalIdOrUrl.startsWith('http')
    ? externalIdOrUrl
    : `https://www.kleinanzeigen.de/s-anzeige/${externalIdOrUrl}`;

  const browser = await launchKaBrowser({
    accountId,
    storageDir: `${dataRoot}/${accountId}`,
    headless: true,
  });
  let page: Page | undefined;
  try {
    page = await browser.context.newPage();
    if (!(await isLoggedIn(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await SEL_EDIT_AD_BTN.click(page);
    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });

    await retry(() => SEL_PRICE_INPUT.fill(page!, Math.round(newPriceEur).toString()), {
      attempts: 2,
      label: 'price-fill',
    });
    await SEL_SAVE_AD_BTN.click(page);
    await page.waitForTimeout(2000);

    log.info('price updated', { externalIdOrUrl, newPriceEur });
    return { ok: true, newPriceEur };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { if (page) await page.close(); } catch { /* */ }
    await browser.close();
  }
}
