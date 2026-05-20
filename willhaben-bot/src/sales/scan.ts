// ──────────────────────────────────────────────────────────────────────────────
// Willhaben Sold-Item Detection
//
// Visits the seller's sold-listings tab and scrapes external IDs. Matching
// rows in `marketplace_listings` (marketplace='willhaben', status='active')
// are flipped to 'sold' so the orchestrator's cross-sync worker can react.
// Idempotent — re-running does not double-trigger.
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext, Page } from 'playwright';
import { createLogger, getDb } from '@vinted-system/shared';
import { SEL_LOGGED_IN, SEL_SOLD_LIST_ITEM } from '../selectors.js';

const log = createLogger('willhaben-sales-scan');
const BASE_URL = process.env.WILLHABEN_BASE_URL ?? 'https://www.willhaben.com';

// TODO: validate sold-page URL. Willhaben sellers see sold items on their
// own profile under "Sold" tab — URL may also be /mypage/listings/?status=sold.
const SOLD_URL_CANDIDATES = [
  `${BASE_URL}/mypage/listings/?status=sold`,
  `${BASE_URL}/mypage/sold/`,
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
      // Wait briefly for hydration; SEL_SOLD_LIST_ITEM presence indicates we landed.
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

  // Auto-scroll to load lazy items
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
      // Only count anchors that are inside a "sold" card. Heuristic: parent
      // contains "Sold" text or a data-status attribute.
      const card = a.closest('li, article, [role="listitem"]') ?? a;
      const txt = (card.textContent ?? '').toLowerCase();
      const status = card.getAttribute('data-status') ?? '';
      if (!/sold/.test(txt) && status !== 'sold') continue;
      seen.add(m[1]);
      out.push({ id: m[1], url: href.startsWith('http') ? href : `https://www.willhaben.com${href}` });
    }
    return out;
  });

  return items.map((it) => ({ externalId: it.id, externalUrl: it.url }));
}

/**
 * Scan Willhaben sold items. For every item found, flips matching
 * `marketplace_listings` row (marketplace='willhaben', account_id=N, status='active')
 * to 'sold'. Idempotent.
 */
export async function scanWillhabenSold(
  accountId: number,
  ctx: BrowserContext,
): Promise<SoldScanStats> {
  const stats: SoldScanStats = { scanned: 0, newlySold: 0, errors: 0 };
  const page = await ctx.newPage();
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      // not authenticated — bail early without polluting stats
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
       WHERE marketplace = 'willhaben' AND account_id = ?
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
      log.info('Willhaben marked sold', { externalId: it.externalId, folderNum: row.folder_num });
    }
  } finally {
    await page.close().catch(() => null);
  }
  return stats;
}
