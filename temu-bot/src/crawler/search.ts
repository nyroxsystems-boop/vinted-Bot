// ──────────────────────────────────────────────────────────────────────────────
// Temu search crawler.
//
// Takes an array of query strings, walks each search page, extracts product
// cards, filters by rating/reviews/price, downloads images, creates folders
// in /Users/home/Desktop/Vinted/Neuer Ordner N/ and queues _input.json files
// for Antigravity.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  getDb,
  dismissOneTrust,
  isBotBlocked,
  type CrawlerFilters,
  type CrawlerPreset,
  type CrawledProduct,
} from '@vinted-system/shared';
import { getTemuBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { CRAWLER } from './selectors.js';
import { downloadImages } from './download.js';
import { materialiseProduct, type ProductRecord } from './folder.js';

const log = createLogger('temu-crawler');

export interface CrawledCard {
  goodsId: string;
  url: string;
  title: string;
  price_eur: number | null;
  rating: number | null;
  review_count: number | null;
  image_urls: string[];
}

export interface CrawlResult {
  query: string;
  candidates: number;
  kept: number;
  errors: number;
  products: Array<{ goods_id: string; folder_num: number; folder_path: string }>;
}

/**
 * Run a full crawl over multiple queries. Respects filters (min rating,
 * min reviews, max price, max per query). Avoids re-crawling goods_ids
 * that already exist in crawled_products.
 */
export async function runCrawl(opts: {
  queries: string[];
  filters: CrawlerFilters;
  presetName?: string;
}): Promise<CrawlResult[]> {
  const mb = await getTemuBrowser();
  const page = await mb.context.newPage();
  const runId = startCrawlerRun(opts);
  const results: CrawlResult[] = [];
  let totalFound = 0;
  let totalKept = 0;

  try {
    await requireLogin(page);
    await page.goto('https://www.temu.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissOneTrust(page);

    for (const query of opts.queries) {
      log.info('Crawling query', { query });
      const cards = await scrapeSearchResults(page, query);
      totalFound += cards.length;

      const filtered = applyFilters(cards, opts.filters);
      log.info('Filter results', {
        query,
        total: cards.length,
        afterFilters: filtered.length,
        cap: opts.filters.max_per_query,
      });

      const kept = filtered.slice(0, opts.filters.max_per_query);
      const resOne: CrawlResult = {
        query,
        candidates: cards.length,
        kept: 0,
        errors: 0,
        products: [],
      };

      for (const card of kept) {
        try {
          if (alreadyCrawled(card.goodsId)) {
            log.info('Skip — already crawled', { goodsId: card.goodsId });
            continue;
          }
          const saved = await persistCard(card, query);
          resOne.products.push({
            goods_id: card.goodsId,
            folder_num: saved.folderNum,
            folder_path: saved.folderPath,
          });
          resOne.kept++;
          totalKept++;
        } catch (err) {
          resOne.errors++;
          log.error('persistCard failed', {
            goodsId: card.goodsId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // pace: don't hammer Temu
        await sleep(1500 + Math.random() * 1500);
      }

      results.push(resOne);
      // Small gap between queries
      await sleep(3_000 + Math.random() * 2_000);
    }

    finishCrawlerRun(runId, 'success', totalFound, totalKept);
  } catch (err) {
    finishCrawlerRun(
      runId,
      'failed',
      totalFound,
      totalKept,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  } finally {
    await page.close();
  }

  return results;
}

// ── Scraping — single search query ────────────────────────────────────────────

async function scrapeSearchResults(page: Page, query: string): Promise<CrawledCard[]> {
  await page.goto(CRAWLER.searchUrl(query), {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  // Wait for at least one product-link to appear before scraping — Temu's
  // initial HTML is sparse and React populates the grid asynchronously.
  await page
    .locator('a[href*="-g-"][href*=".html"]')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

  const block = await isBotBlocked(page);
  if (block.blocked) {
    log.warn('Temu blocked on search', { query, reason: block.reason });
    return [];
  }

  // Scroll several times to trigger lazy-loads for the full first screen
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 2000);
    await sleep(1200);
  }

  // Extract cards via in-page JS — much more robust than CSS selectors
  const cards = await page.evaluate(() => {
    const out: Array<{
      goodsId: string;
      url: string;
      title: string;
      priceText: string | null;
      ratingText: string | null;
      reviewText: string | null;
      imgUrl: string | null;
    }> = [];
    const seen = new Set<string>();

    // Any link to a product page matches /de/{slug}-g-{goodsId}.html
    document.querySelectorAll<HTMLAnchorElement>('a[href*="-g-"][href*=".html"]').forEach((a) => {
      const href = a.href;
      const m = href.match(/-g-(\d{10,})\.html/);
      if (!m?.[1]) return;
      const goodsId = m[1];
      if (seen.has(goodsId)) return;
      seen.add(goodsId);

      // Find a reasonable ancestor card for this link
      const card =
        a.closest<HTMLElement>('[class*="card"]') ??
        a.closest<HTMLElement>('div[data-goods-id]') ??
        a.parentElement?.parentElement ??
        a.parentElement ??
        a;

      const img = card.querySelector<HTMLImageElement>('img');
      const title =
        (a.getAttribute('aria-label') ?? a.textContent ?? img?.alt ?? '').trim();

      const fullText = (card.innerText ?? '').replace(/\s+/g, ' ').trim();
      // Best-effort extractors
      const priceText = (fullText.match(/€\s*\d+[.,]\d{1,2}|\d+[.,]\d{1,2}\s*€/) ?? [null])[0];
      const ratingText = (fullText.match(/\b([0-5](?:[.,]\d)?)\s*(?:★|★|Stern|von 5|\/5)/i) ?? [null])[0];
      const reviewText = (fullText.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:Verkäufe|sold|Bewertungen|reviews)/i) ??
        [null])[0];

      out.push({
        goodsId,
        url: href,
        title: title.slice(0, 200),
        priceText,
        ratingText,
        reviewText,
        imgUrl: img?.src ?? null,
      });
    });
    return out;
  });

  if (cards.length === 0) {
    log.warn('No cards parsed — dumping diagnostic', {
      query,
      url: page.url(),
      title: await page.title().catch(() => ''),
    });
    return [];
  }

  return cards.map((c) => ({
    goodsId: c.goodsId,
    url: c.url.startsWith('http') ? c.url : `https://www.temu.com${c.url}`,
    title: c.title,
    price_eur: parseEuro(c.priceText),
    rating: parseRating(c.ratingText),
    review_count: parseReviewCount(c.reviewText),
    image_urls: c.imgUrl ? [upgradeImageUrl(c.imgUrl)] : [],
  }));
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilters(cards: CrawledCard[], filters: CrawlerFilters): CrawledCard[] {
  // Temu search-result cards often omit rating + review_count (only shown
  // on the detail page). Treat unknown values as "pass the filter" — the
  // user can still filter by price, and the DB tracks whatever we did
  // extract. Hard-filtering on unknown values would exclude every product.
  return cards.filter((c) => {
    if (c.image_urls.length === 0) return false;
    if (c.price_eur !== null && c.price_eur > filters.max_price_eur) return false;
    if (c.rating !== null && filters.min_rating > 0 && c.rating < filters.min_rating) return false;
    if (
      c.review_count !== null &&
      filters.min_reviews > 0 &&
      c.review_count < filters.min_reviews
    )
      return false;
    return true;
  });
}

// ── Persist ────────────────────────────────────────────────────────────────────

async function persistCard(card: CrawledCard, query: string): Promise<{
  folderNum: number;
  folderPath: string;
}> {
  const product: ProductRecord = {
    temu_goods_id: card.goodsId,
    temu_url: card.url,
    title: card.title,
    price_eur: card.price_eur,
    rating: card.rating,
    review_count: card.review_count,
    search_query: query,
    image_urls: card.image_urls,
  };
  const { folderNum, folderPath, queuePath } = await materialiseProduct(product, downloadImages);

  // DB insert
  getDb()
    .prepare(
      `INSERT INTO crawled_products
         (temu_goods_id, temu_url, title, price_eur, rating, review_count,
          search_query, folder_num, folder_path, queue_file_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'crawled')`,
    )
    .run(
      card.goodsId,
      card.url,
      card.title,
      card.price_eur,
      card.rating,
      card.review_count,
      query,
      folderNum,
      folderPath,
      queuePath,
    );

  return { folderNum, folderPath };
}

function alreadyCrawled(goodsId: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM crawled_products WHERE temu_goods_id = ?')
    .get(goodsId);
  return !!row;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseEuro(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+[.,]\d{1,2})/);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseRating(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d(?:[.,]\d)?)/);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n <= 5 ? n : null;
}

function parseReviewCount(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)/);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1].replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function upgradeImageUrl(url: string): string {
  // Temu thumbnails like /t/.../60x60/... — request a higher resolution
  return url.replace(/\/\d{2,4}x\d{2,4}\//, '/800x800/');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── DB audit helpers ──────────────────────────────────────────────────────────

function startCrawlerRun(opts: {
  queries: string[];
  filters: CrawlerFilters;
  presetName?: string;
}): number {
  const res = getDb()
    .prepare(
      `INSERT INTO crawler_runs (preset_name, queries, filters, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(
      opts.presetName ?? null,
      JSON.stringify(opts.queries),
      JSON.stringify(opts.filters),
    );
  return res.lastInsertRowid as number;
}

function finishCrawlerRun(
  id: number,
  status: 'success' | 'partial' | 'failed' | 'cancelled',
  found: number,
  kept: number,
  error?: string,
): void {
  getDb()
    .prepare(
      `UPDATE crawler_runs
         SET ended_at = datetime('now'), status = ?,
             products_found = ?, products_kept = ?, error = ?
       WHERE id = ?`,
    )
    .run(status, found, kept, error ?? null, id);
}

// ── Presets loader ────────────────────────────────────────────────────────────

export async function loadPresets(): Promise<{
  default_filters: CrawlerFilters;
  presets: CrawlerPreset[];
}> {
  const fs = await import('node:fs/promises');
  const path = '/Users/home/Desktop/Vinted/_crawler/presets.json';
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw);
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function listProducts(status?: CrawledProduct['status']): CrawledProduct[] {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM crawled_products WHERE status = ? ORDER BY crawled_at DESC')
      .all(status) as CrawledProduct[];
  }
  return getDb()
    .prepare('SELECT * FROM crawled_products ORDER BY crawled_at DESC LIMIT 500')
    .all() as CrawledProduct[];
}

export function listRuns(limit = 20): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM crawler_runs ORDER BY started_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
}
