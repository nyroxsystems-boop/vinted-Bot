// ──────────────────────────────────────────────────────────────────────────────
// Grailed Sold-Items Scan
//
// Visits /sold (a.k.a. /users/myitems?sold=true on some routes) and reads
// the list of items the seller has sold. For each matched external_id we
// flip marketplace_listings.status to 'sold'.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-scan');

// TODO: validate against live site. Grailed has at least two routes for
// "sold by me" depending on the user's account state; we try the canonical
// one first and fall back to "my items".
const SOLD_URLS: ReadonlyArray<string> = [
  '/sold',
  '/users/myitems?sold=true',
  '/users/me/sold',
];

const LISTING_LINK = 'a[href*="/listings/"]';

export interface ScanResult {
  scanned: number;
  inserted: number;
  updated: number;
  warnings: string[];
}

export async function scanGrailedSold(accountId: number): Promise<ScanResult> {
  const warnings: string[] = [];
  const db = getDb();
  const ctx = await launchGrailed(accountId, true);
  const page = await ctx.newPage();
  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  try {
    const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 25_000 });
    if (!home.ok) {
      warnings.push(`home: ${home.error}`);
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }
    if (!(await isGrailedLoggedIn(page))) {
      warnings.push('not authenticated');
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }

    // Try each candidate URL until we land on a page that has listing links.
    let foundUrl = '';
    for (const path of SOLD_URLS) {
      const nav = await cloudflareSafeNavigate(page, `${GRAILED_BASE_URL}${path}`, { timeoutMs: 25_000 });
      if (!nav.ok) {
        warnings.push(`nav ${path}: ${nav.error}`);
        continue;
      }
      await page.waitForTimeout(1_500);
      const cnt = await page.locator(LISTING_LINK).count();
      if (cnt > 0) {
        foundUrl = path;
        break;
      }
    }
    if (!foundUrl) {
      warnings.push('no sold-items page yielded listing links');
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }

    // Auto-scroll for lazy-loaded items.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200).catch(() => null);
      await page.waitForTimeout(600);
    }

    const ids = await page.evaluate(() => {
      const out: Array<{ id: string; url: string; soldHint: boolean }> = [];
      const seen = new Set<string>();
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/listings/"]'));
      for (const a of anchors) {
        const href = a.getAttribute('href') ?? '';
        const m = href.match(/\/listings\/(\d+|[A-Za-z0-9_-]+)/);
        if (!m?.[1]) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        // Walk up to nearest card to look for a "sold" badge.
        const card = a.closest('li, article, [class*="card" i], [class*="listing" i]') ?? a;
        const cardText = (card.textContent ?? '').toLowerCase();
        const soldHint =
          cardText.includes('sold') ||
          !!card.querySelector('[data-testid*="sold" i], [class*="sold" i]');
        out.push({ id: m[1], url: href.startsWith('http') ? href : `https://www.grailed.com${href}`, soldHint });
      }
      return out;
    }).catch(() => [] as Array<{ id: string; url: string; soldHint: boolean }>);

    scanned = ids.length;
    if (scanned === 0) {
      warnings.push('no listing ids extracted');
      return { scanned: 0, inserted: 0, updated: 0, warnings };
    }

    for (const it of ids) {
      // On a sold-only page we trust the page; outside we trust the badge.
      const looksSold = it.soldHint || /sold/i.test(foundUrl);
      if (!looksSold) continue;

      const ml = db
        .prepare(
          `SELECT id, folder_num, status FROM marketplace_listings
             WHERE marketplace = 'grailed' AND account_id = ?
               AND external_id = ?`,
        )
        .get(accountId, it.id) as
        | { id: number; folder_num: number; status: string }
        | undefined;
      if (!ml) continue;
      if (ml.status === 'sold') continue;

      db.prepare(
        `UPDATE marketplace_listings
            SET status = 'sold', updated_at = datetime('now')
          WHERE id = ?`,
      ).run(ml.id);
      updated++;
      log.info('Grailed listing marked sold', { external_id: it.id, folder_num: ml.folder_num });

      const legacy = db
        .prepare(
          `SELECT id FROM listings WHERE account_id = ? AND folder_num = ? LIMIT 1`,
        )
        .get(accountId, ml.folder_num) as { id: number } | undefined;
      if (legacy) {
        const existing = db
          .prepare(`SELECT id FROM sales WHERE listing_id = ?`)
          .get(legacy.id) as { id: number } | undefined;
        if (!existing) {
          db.prepare(
            `INSERT INTO sales (listing_id, buyer_name, paid_at)
             VALUES (?, ?, datetime('now'))`,
          ).run(legacy.id, 'PENDING');
          inserted++;
        }
      }
    }

    return { scanned, inserted, updated, warnings };
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return { scanned, inserted, updated, warnings };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
