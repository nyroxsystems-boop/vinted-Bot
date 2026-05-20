// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — poll sold items.
//
// Scrapes /member/sold/ for new sales. Returns array of detected sold listings.
// Orchestrator persists into its sales table.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_SOLD_URL,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('vc-sold-poll');
const BASE_URL = 'https://www.vestiairecollective.com';

// TODO: validate — Vestiaire selectors for sold-items list.
const SOLD_ROW_SELECTORS = [
  '[data-testid="sold-item"]',
  '[class*="SoldItem" i]',
  'a[href*="/item/"][data-status*="sold"]',
  'div[class*="OrderItem" i]',
  'li[class*="Order" i]',
];

export interface VcSoldItem {
  externalId: string;
  externalUrl: string | null;
  title: string | null;
  pricePaidEur: number | null;
  buyerName: string | null;
  soldAt: string | null;
}

export interface SoldPollResult {
  ok: boolean;
  items: VcSoldItem[];
  scanned: number;
  error?: string;
}

async function firstWorkingSelector(page: Page, candidates: readonly string[]) {
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

export async function pollVestiaireSold(page: Page): Promise<SoldPollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, items: [], scanned: 0, error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_SOLD_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    if (await SEL_BLOCKED.exists(page)) return { ok: false, items: [], scanned: 0, error: 'blocked' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, items: [], scanned: 0, error: 'captcha' };

    const rowSel = await firstWorkingSelector(page, SOLD_ROW_SELECTORS);
    if (!rowSel) {
      return { ok: true, items: [], scanned: 0 };
    }
    const rows = page.locator(rowSel);
    const count = await rows.count();
    const items: VcSoldItem[] = [];
    const scanned = Math.min(count, 50);

    for (let i = 0; i < scanned; i++) {
      try {
        const row = rows.nth(i);
        const text = (await row.innerText({ timeout: 1500 }).catch(() => '')).trim();
        const link = row.locator('a[href*="/item/"], a[href*="/products/"]').first();
        const href = await link.getAttribute('href').catch(() => null);
        const externalUrl = href
          ? (href.startsWith('http') ? href : `${BASE_URL}${href}`)
          : null;
        const m = href?.match(/(\d{6,})(?:[/.])/) ?? href?.match(/-(\d{6,})\.shtml/) ?? null;
        const externalId = m?.[1] ?? `vc-sold-${i}`;
        const title = (await row.locator('h2, h3, [class*="title" i]').first().innerText({ timeout: 800 }).catch(() => '')).trim() || null;
        const pricePaidEur = parseEuro(text);
        const buyerName = (await row.locator('[class*="buyer" i], [data-testid*="buyer"]').first().innerText({ timeout: 800 }).catch(() => '')).trim() || null;

        items.push({
          externalId,
          externalUrl,
          title,
          pricePaidEur,
          buyerName,
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
