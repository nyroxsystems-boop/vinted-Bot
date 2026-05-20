// ──────────────────────────────────────────────────────────────────────────────
// Wallapop Sold-Item Detection
//
// Visits the seller's sold-listings tab and scrapes external IDs. Matching
// rows in `marketplace_listings` (marketplace='wallapop', status='active')
// are flipped to 'sold' so the orchestrator's cross-sync worker can react.
// Idempotent — re-running does not double-trigger.
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext, Page } from 'playwright';
import { createLogger, getDb } from '@vinted-system/shared';
import { SEL_LOGGED_IN, SEL_SOLD_LIST_ITEM } from '../selectors.js';

const log = createLogger('wp-sales-scan');
const BASE_URL = process.env.WALLAPOP_BASE_URL ?? 'https://es.wallapop.com';

// TODO: validate sold-page URLs. Wallapop seller area is `/app/catalog`,
// sold filter may be `?status=sold` or a separate tab.
const SOLD_URL_CANDIDATES = [
  `${BASE_URL}/app/catalog?status=sold`,
  `${BASE_URL}/app/catalog/sold`,
  `${BASE_URL}/app/catalog`,
];

export interface SoldScanStats {
  scanned: number;
  newlySold: number;
  errors: number;
}

interface SoldItem {
  externalId: string;
  externalUrl: string;
}

async function scrapeSoldItems(page: Page): Promise<SoldItem[]> {
  let foundUrl: string | null = null;
  for (const url of SOLD_URL_CANDIDATES) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForTimeout(1500);
      if (await SEL_SOLD_LIST_ITEM.exists(page)) {
        foundUrl = url;
        break;
      }
    } catch {
      /* try next URL */
    }
  }
  if (!foundUrl) {
    log.warn('No sold-page candidate yielded items', { tried: SOLD_URL_CANDIDATES });
    return [];
  }

  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1200).catch(() => undefined);
    await page.waitForTimeout(600);
  }

  const items = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/item/"]'),
    );
    const out: Array<{ id: string; url: string }> = [];
    const seen = new Set<string>();
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(/\/item\/([a-zA-Z0-9_-]+)/);
      if (!m || !m[1]) continue;
      if (seen.has(m[1])) continue;
      // Only count "Sold/Vendido" cards
      const card = a.closest('li, article, [role="listitem"]') ?? a;
      const txt = (card.textContent ?? '').toLowerCase();
      const status = card.getAttribute('data-status') ?? '';
      if (!/(sold|vendido)/.test(txt) && status !== 'sold') continue;
      seen.add(m[1]);
      out.push({
        id: m[1],
        url: href.startsWith('http') ? href : `https://es.wallapop.com${href}`,
      });
    }
    return out;
  });

  return items.map((it) => ({ externalId: it.id, externalUrl: it.url }));
}

/**
 * Scan Wallapop sold items. For every item found, flips the matching
 * `marketplace_listings` row (marketplace='wallapop', status='active') to
 * 'sold'. Idempotent.
 */
export async function scanWallapopSold(
  accountId: number,
  ctx: BrowserContext,
): Promise<SoldScanStats> {
  const stats: SoldScanStats = { scanned: 0, newlySold: 0, errors: 0 };
  const page = await ctx.newPage();
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      stats.errors++;
      return stats;
    }

    let items: SoldItem[] = [];
    try {
      items = await scrapeSoldItems(page);
    } catch (err) {
      log.warn('Scrape failed', { error: err instanceof Error ? err.message : String(err) });
      stats.errors++;
      return stats;
    }
    stats.scanned = items.length;
    if (items.length === 0) return stats;

    const db = getDb();
    const find = db.prepare(`
      SELECT id, folder_num, status FROM marketplace_listings
       WHERE marketplace = 'wallapop' AND account_id = ?
         AND external_id = ?
         AND status = 'active'
    `);
    const flip = db.prepare(`
      UPDATE marketplace_listings
         SET status = 'sold', updated_at = datetime('now')
       WHERE id = ?
    `);

    for (const it of items) {
      const row = find.get(accountId, it.externalId) as
        | { id: number; folder_num: number; status: string }
        | undefined;
      if (!row) continue;
      flip.run(row.id);
      stats.newlySold++;
      log.info('Wallapop marked sold', { externalId: it.externalId, folderNum: row.folder_num });
    }
  } finally {
    await page.close().catch(() => null);
  }
  return stats;
}
