// ──────────────────────────────────────────────────────────────────────────────
// Vinted Trend Scraper
//
// Pulls demand-side signals directly from Vinted (instead of relying on CJ's
// supplier-side "popularity" ranking) so CJ-Discovery can target what
// Vinted-buyers are actually searching for.
//
// We hit three sources in one logged-in session:
//   1. /brands       → top-ranked clothing brands (Zara, Nike, COS, …)
//   2. /catalog      → "Trending now" / "Beliebte Suchen" section
//   3. /catalog?…    → Damen-Kleidung listings — extract title-tokens as
//                      hashtag/keyword candidates ("Y2K", "Boho", "Mini")
//
// Important constraints:
//   • CAPTCHA-detection via shared/isBotBlocked → abort early, return []
//   • Max 3 navigations per call, with humanDelay() between them. We're
//     scraping our own logged-in account; over-eagerness flags it as a bot.
//   • Selectors are BEST-GUESS. Vinted's DOM uses generated class names so
//     we try data-testid first, then href-based fallbacks. Log a TODO when
//     a section returns zero items so the next maintainer knows where to look.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  isBotBlocked,
  type VintedTrend,
  humanDelay,
  humanScroll,
} from '@vinted-system/shared';
import { getVintedBrowser } from './browser.js';
import { requireLogin } from './auth.js';
import { dumpDom } from './dom-debug.js';

const log = createLogger('vinted-trend-scraper');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

// Hard limits — we're touching a real user account, friendly traffic only.
const MAX_BRANDS = 50;
const MAX_SEARCHES = 30;
const MAX_HASHTAGS = 40;
const NAV_TIMEOUT_MS = 30_000;

/** Light Latin-token tokenizer used for title→hashtag extraction. */
function tokenize(s: string): string[] {
  if (!s) return [];
  // Lowercase, strip emoji + symbols, split on whitespace and most punctuation.
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-']/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.length <= 24);
}

// Generic stopwords (DE+EN) we don't want as "hashtag" candidates.
const STOPWORDS = new Set<string>([
  // DE
  'der', 'die', 'das', 'und', 'oder', 'aber', 'für', 'von', 'mit', 'ohne',
  'auf', 'auch', 'sehr', 'neu', 'top', 'schwarz', 'weiß', 'rot', 'blau',
  'grün', 'gelb', 'braun', 'grau', 'rosa', 'gr', 'gr.', 'größe', 'eur',
  // EN
  'the', 'and', 'with', 'without', 'for', 'from', 'new', 'top', 'size',
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'brown', 'gray',
  'pink', 'usa', 'eu',
  // common Vinted-noise
  'damen', 'herren', 'kinder', 'shirt', 'shirts', 'kleid',
]);

/**
 * Pull href-list items matching a CSS-or-textContent strategy and
 * return text + url pairs. Tolerates timeouts — returns [] on failure.
 */
async function safeListItems(
  page: Page,
  selectors: string[],
  max: number,
): Promise<Array<{ text: string; href: string | null }>> {
  for (const sel of selectors) {
    try {
      const handles = await page.locator(sel).elementHandles();
      if (handles.length === 0) continue;
      const out: Array<{ text: string; href: string | null }> = [];
      for (const h of handles.slice(0, max * 2)) {
        const txt = (await h.innerText().catch(() => ''))?.trim();
        const href = await h.getAttribute('href').catch(() => null);
        if (txt) out.push({ text: txt, href });
        if (out.length >= max) break;
      }
      if (out.length > 0) return out;
    } catch {
      /* try next selector */
    }
  }
  return [];
}

/** Build a snapshot of Vinted trends for the given Vinted account. */
export async function scrapeVintedTrends(accountId: number): Promise<VintedTrend[]> {
  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  const trends: VintedTrend[] = [];
  const scrapedAt = new Date().toISOString();

  try {
    // Ensure we're authenticated — many catalog widgets are user-personalized,
    // and we want the logged-in variant for accurate signal.
    await requireLogin(page, accountId).catch((err) => {
      log.warn('requireLogin failed in trend-scraper — continuing anonymously', {
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // ── Source 1: Top-Brands ────────────────────────────────────────────────
    const brandsUrl = `${BASE_URL}/brands`;
    try {
      await page.goto(brandsUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await humanDelay(800, 1800);
      const blocked = await isBotBlocked(page);
      if (blocked.blocked) {
        log.warn('Bot block detected on /brands — aborting trend-scrape', { reason: blocked.reason });
        return [];
      }
      await humanScroll(page, 400);
      await humanDelay(400, 900);

      // TODO: Re-verify selectors — Vinted's /brands page is server-rendered
      // with mostly anonymous class names. We try data-testid first, then
      // any anchor that links to a /brand/ slug. Listing-pages dedupe by
      // (keyword, locale, day) so duplicates here are harmless.
      const brandSelectors = [
        'a[data-testid="brand-list-item"]',
        'a[data-testid^="brand-"]',
        'main a[href*="/brand/"]',
        'a[href*="/brand/"]',
      ];
      let items = await safeListItems(page, brandSelectors, MAX_BRANDS);
      if (items.length === 0) {
        log.warn('Top-brands selector returned zero items — falling back to dom-debug sweep');
        // Fallback: dom-debug already collects every <a href*="/brand/"> on
        // the page in DOM-order, which is also the visual ranking on /brands.
        const dump = await dumpDom(page, { types: ['brand'], perType: MAX_BRANDS }).catch(() => null);
        if (dump && dump.brand_candidates.length > 0) {
          items = dump.brand_candidates.map((c) => ({
            text: c.text,
            href: c.href ?? null,
          }));
          log.warn('Top-brands recovered via dom-debug', { count: items.length });
        }
      }
      const seen = new Set<string>();
      items.forEach((it, idx) => {
        const name = it.text.split('\n')[0]?.trim();
        if (!name || seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());
        trends.push({
          trend_type: 'brand',
          keyword: name,
          locale: 'de',
          rank: idx + 1,
          popularity: 1 - idx / MAX_BRANDS,
          source_url: it.href ? new URL(it.href, BASE_URL).toString() : brandsUrl,
          scraped_at: scrapedAt,
        });
      });
    } catch (err) {
      log.warn('Top-brands scrape failed', { err: err instanceof Error ? err.message : String(err) });
    }

    // ── Source 2: Catalog "Beliebte Suchen" / "Trending now" ───────────────
    const catalogUrl = `${BASE_URL}/catalog`;
    try {
      await humanDelay(800, 1800);
      await page.goto(catalogUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await humanDelay(600, 1400);
      const blocked = await isBotBlocked(page);
      if (blocked.blocked) {
        log.warn('Bot block on /catalog — aborting further trend-scrape', { reason: blocked.reason });
        return trends; // return what we already collected from /brands
      }
      await humanScroll(page, 600);
      await humanDelay(400, 900);

      // TODO: Vinted occasionally renames the "Beliebte Suchen" widget; if
      // these selectors all fail we still gracefully degrade to category
      // tokens collected via Source 3 below.
      const searchSelectors = [
        '[data-testid="trending-searches"] a',
        '[data-testid*="trending"] a',
        '[data-testid="popular-searches"] a',
        'section a[href*="search_text="]',
        'a[href*="search_text="]',
      ];
      let items = await safeListItems(page, searchSelectors, MAX_SEARCHES);
      if (items.length === 0) {
        log.warn('Catalog top-searches selector returned zero items — falling back to dom-debug sweep');
        // Fallback: any <a href*="search_text=…"> on the catalog page is a
        // popular-search chip. DOM-order ≈ visual rank, same heuristic as
        // /brands.
        const dump = await dumpDom(page, { types: ['search'], perType: MAX_SEARCHES }).catch(() => null);
        if (dump && dump.search_candidates.length > 0) {
          items = dump.search_candidates.map((c) => ({
            text: c.text,
            href: c.href ?? null,
          }));
          log.warn('Top-searches recovered via dom-debug', { count: items.length });
        }
      }
      const seen = new Set<string>();
      items.forEach((it, idx) => {
        const q = it.text.split('\n')[0]?.trim();
        if (!q || seen.has(q.toLowerCase())) return;
        seen.add(q.toLowerCase());
        trends.push({
          trend_type: 'search',
          keyword: q,
          locale: 'de',
          rank: idx + 1,
          popularity: 1 - idx / MAX_SEARCHES,
          source_url: it.href ? new URL(it.href, BASE_URL).toString() : catalogUrl,
          scraped_at: scrapedAt,
        });
      });
    } catch (err) {
      log.warn('Catalog top-searches scrape failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Source 3: Damen-Kleidung listings → hashtag/keyword tokens ─────────
    const damenUrl = `${BASE_URL}/catalog?catalog[]=1904`;
    try {
      await humanDelay(800, 1800);
      await page.goto(damenUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await humanDelay(600, 1400);
      const blocked = await isBotBlocked(page);
      if (blocked.blocked) {
        log.warn('Bot block on Damen-Kleidung — aborting further trend-scrape', { reason: blocked.reason });
        return trends;
      }
      await humanScroll(page, 800);
      await humanDelay(400, 900);

      // TODO: titles live in card components — these selectors are best-guess
      // and may need revisiting. The point of this source is hashtag-like
      // tokens, not exact listing names, so noisy data is acceptable.
      const titleSelectors = [
        '[data-testid="item-title"]',
        'a[data-testid="item-box"]',
        '.feed-grid__item a[title]',
        '.feed-grid__item a',
      ];
      const items = await safeListItems(page, titleSelectors, 20);
      if (items.length === 0) {
        log.warn('Damen-Kleidung title selector returned zero items');
      }

      // Tokenize all titles, count frequency, take top-N.
      const freq = new Map<string, number>();
      for (const it of items) {
        const tokens = tokenize(it.text);
        for (const t of tokens) {
          if (STOPWORDS.has(t)) continue;
          // Skip pure-numeric tokens ("38", "2024").
          if (/^\d+$/.test(t)) continue;
          freq.set(t, (freq.get(t) ?? 0) + 1);
        }
      }
      const sorted = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_HASHTAGS);
      const totalSeen = sorted[0]?.[1] ?? 1;
      sorted.forEach(([token, n], idx) => {
        trends.push({
          trend_type: 'hashtag',
          keyword: token,
          locale: 'de',
          rank: idx + 1,
          popularity: n / totalSeen,
          category_path: 'Damen > Kleidung',
          source_url: damenUrl,
          metadata_json: JSON.stringify({ occurrences: n, sample_size: items.length }),
          scraped_at: scrapedAt,
        });
      });
    } catch (err) {
      log.warn('Damen-Kleidung hashtag scrape failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Final dedupe across sources — same keyword in two trend_types is OK,
    // but identical (type, keyword) should collapse to the higher rank.
    const dedupe = new Map<string, VintedTrend>();
    for (const t of trends) {
      const key = `${t.trend_type}::${t.keyword.toLowerCase()}`;
      const prev = dedupe.get(key);
      if (!prev || (t.rank ?? 1e9) < (prev.rank ?? 1e9)) {
        dedupe.set(key, t);
      }
    }
    const out = [...dedupe.values()].sort((a, b) => {
      if (a.trend_type !== b.trend_type) return a.trend_type.localeCompare(b.trend_type);
      return (a.rank ?? 1e9) - (b.rank ?? 1e9);
    });

    log.info('Vinted trend-scrape complete', {
      accountId,
      brands: out.filter((t) => t.trend_type === 'brand').length,
      searches: out.filter((t) => t.trend_type === 'search').length,
      hashtags: out.filter((t) => t.trend_type === 'hashtag').length,
    });
    return out;
  } finally {
    await page.close().catch(() => null);
  }
}
