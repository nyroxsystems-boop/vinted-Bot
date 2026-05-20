// ──────────────────────────────────────────────────────────────────────────────
// Depop Sold-Items Poll
//
// Visits /my-shop/sold/ and scrapes the list of products the bot has sold.
// Compares against marketplace_listings.status = 'active' and flips matching
// rows to 'sold', which the orchestrator's cross-sync worker then propagates
// to other marketplaces (Vinted/KA deactivation).
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';

const log = createLogger('depop-sold-poll');
const SOLD_URL = 'https://www.depop.com/my-shop/sold/';

export interface SoldScanStats {
  scanned: number;
  newly_sold: number;
  errors: number;
}

interface SoldItem {
  external_id: string;
  external_url: string;
}

/** Scrape the list of sold product IDs from /my-shop/sold/. */
async function scrapeSoldItems(ctx: BrowserContext): Promise<SoldItem[]> {
  const page = await ctx.newPage();
  try {
    const nav = await cloudflareSafeNavigate(page, SOLD_URL, { timeoutMs: 30_000 });
    if (!nav.ok) {
      log.warn('Sold-page navigation failed', { error: nav.error });
      return [];
    }
    await page.waitForTimeout(1500);

    // Auto-scroll to make sure all items load (Depop lazy-loads)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200).catch(() => undefined);
      await page.waitForTimeout(600);
    }

    const items = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/products/"]'));
      const out: Array<{ id: string; url: string }> = [];
      const seen = new Set<string>();
      for (const a of anchors) {
        const href = a.getAttribute('href') ?? '';
        const m = href.match(/\/products\/([a-zA-Z0-9_-]+)/);
        if (!m || !m[1]) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], url: href.startsWith('http') ? href : `https://www.depop.com${href}` });
      }
      return out;
    });
    return items.map((it) => ({ external_id: it.id, external_url: it.url }));
  } finally {
    await page.close();
  }
}

/**
 * Poll sold-page and mark matching marketplace_listings rows as sold.
 * Idempotent: re-polling does not double-trigger.
 */
export async function pollDepopSold(
  accountId: number,
  ctx: BrowserContext,
): Promise<SoldScanStats> {
  const stats: SoldScanStats = { scanned: 0, newly_sold: 0, errors: 0 };
  let items: SoldItem[];
  try {
    items = await scrapeSoldItems(ctx);
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
     WHERE marketplace = 'depop' AND account_id = ?
       AND external_id = ?
       AND status = 'active'
  `);
  const flip = db.prepare(`
    UPDATE marketplace_listings
       SET status = 'sold', updated_at = datetime('now')
     WHERE id = ?
  `);

  for (const it of items) {
    const row = find.get(accountId, it.external_id) as { id: number; folder_num: number; status: string } | undefined;
    if (!row) continue;
    flip.run(row.id);
    stats.newly_sold++;
    log.info('Marked sold', { external_id: it.external_id, folder_num: row.folder_num });
  }

  return stats;
}
