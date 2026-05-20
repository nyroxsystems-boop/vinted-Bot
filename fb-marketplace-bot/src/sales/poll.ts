// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — poll sold listings.
//
// Scrapes /marketplace/you/selling, filters rows marked "Sold/Verkauft".
// FB doesn't have a clean orders/transactions page, so we infer from listings.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_YOUR_LISTINGS_URL,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-sold-poll');
const BASE_URL = 'https://www.facebook.com';

const SOLD_ROW_SELECTORS = [
  '[aria-label*="Sold" i]',
  '[aria-label*="Verkauft" i]',
  'a[href*="/marketplace/item/"][aria-label*="Sold" i]',
  'a[href*="/marketplace/item/"]', // fallback: filter by text
];

export interface FbSoldItem {
  externalId: string;
  externalUrl: string | null;
  title: string | null;
  pricePaidEur: number | null;
  buyerName: string | null;
  soldAt: string | null;
}

export interface SoldPollResult {
  ok: boolean;
  items: FbSoldItem[];
  scanned: number;
  error?: string;
}

async function firstWorking(page: Page, candidates: readonly string[]) {
  for (const sel of candidates) {
    try {
      const c = await page.locator(sel).count();
      if (c > 0) return sel;
    } catch { /* try next */ }
  }
  return null;
}

function parseEuro(text: string): number | null {
  const m = text.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€/);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

export async function pollFbSold(page: Page): Promise<SoldPollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, items: [], scanned: 0, error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_YOUR_LISTINGS_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3500); // FB hydration

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, items: [], scanned: 0, error: 'FB checkpoint' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, items: [], scanned: 0, error: 'captcha' };

    const sel = await firstWorking(page, SOLD_ROW_SELECTORS);
    if (!sel) return { ok: true, items: [], scanned: 0 };

    const rows = page.locator(sel);
    const count = await rows.count();
    const items: FbSoldItem[] = [];
    const scanned = Math.min(count, 50);

    for (let i = 0; i < scanned; i++) {
      try {
        const row = rows.nth(i);
        const text = (await row.innerText({ timeout: 1500 }).catch(() => '')).trim();

        // If fallback selector grabbed all items, filter by sold-marker in text.
        if (sel === 'a[href*="/marketplace/item/"]' && !/sold|verkauft/i.test(text)) continue;

        const href = await row.getAttribute('href').catch(() => null);
        const externalUrl = href
          ? (href.startsWith('http') ? href : `${BASE_URL}${href}`)
          : null;
        const m = href?.match(/\/marketplace\/item\/(\d+)/) ?? null;
        const externalId = m?.[1] ?? `fb-sold-${i}`;
        const title = text.split('\n')[0]?.trim() ?? null;
        const pricePaidEur = parseEuro(text);

        items.push({
          externalId,
          externalUrl,
          title,
          pricePaidEur,
          buyerName: null,  // FB doesn't expose buyer on listings list
          soldAt: new Date().toISOString(),
        });
      } catch (err) {
        log.warn('sold row scrape failed', { idx: i, err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok: true, items, scanned };
  } catch (err) {
    return { ok: false, items: [], scanned: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
