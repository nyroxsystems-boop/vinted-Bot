// ──────────────────────────────────────────────────────────────────────────────
// Whatnot — poll sold orders.
// Whatnot orders live under /sellhub/orders. We scrape recent entries.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_ORDERS_URL,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('whatnot-sold-poll');
const BASE_URL = 'https://www.whatnot.com';

// TODO: validate — Whatnot order-row selectors.
const ORDER_ROW_SELECTORS = [
  '[data-testid="order-row"]',
  '[data-testid*="order"]',
  '[class*="OrderRow" i]',
  'tr[class*="order" i]',
  'a[href*="/orders/"]',
];

export interface WnSoldItem {
  externalId: string;
  externalUrl: string | null;
  title: string | null;
  pricePaidUsd: number | null;
  buyerName: string | null;
  soldAt: string | null;
}

export interface SoldPollResult {
  ok: boolean;
  items: WnSoldItem[];
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

function parseUsd(text: string): number | null {
  const m = text.match(/\$\s?(\d{1,5}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

export async function pollWhatnotSold(page: Page): Promise<SoldPollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, items: [], scanned: 0, error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_ORDERS_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    if (await SEL_BLOCKED.exists(page)) return { ok: false, items: [], scanned: 0, error: 'blocked' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, items: [], scanned: 0, error: 'captcha' };

    const sel = await firstWorking(page, ORDER_ROW_SELECTORS);
    if (!sel) return { ok: true, items: [], scanned: 0 };

    const rows = page.locator(sel);
    const count = await rows.count();
    const items: WnSoldItem[] = [];
    const scanned = Math.min(count, 50);

    for (let i = 0; i < scanned; i++) {
      try {
        const row = rows.nth(i);
        const text = (await row.innerText({ timeout: 1500 }).catch(() => '')).trim();
        const link = row.locator('a[href*="/orders/"], a[href*="/listing/"]').first();
        const href = await link.getAttribute('href').catch(() => null);
        const externalUrl = href
          ? (href.startsWith('http') ? href : `${BASE_URL}${href}`)
          : null;
        const m = href?.match(/\/orders\/([^/?#]+)/) ?? href?.match(/\/listing\/([^/?#]+)/) ?? null;
        const externalId = m?.[1] ?? `wn-sold-${i}`;
        const title = (await row.locator('h2, h3, [class*="title" i]').first().innerText({ timeout: 800 }).catch(() => '')).trim() || null;
        const pricePaidUsd = parseUsd(text);
        const buyerName = (await row.locator('[class*="buyer" i], [data-testid*="buyer"]').first().innerText({ timeout: 800 }).catch(() => '')).trim() || null;

        items.push({
          externalId,
          externalUrl,
          title,
          pricePaidUsd,
          buyerName,
          soldAt: new Date().toISOString(),
        });
      } catch (err) {
        log.warn('order row scrape failed', { idx: i, err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok: true, items, scanned };
  } catch (err) {
    return { ok: false, items: [], scanned: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
