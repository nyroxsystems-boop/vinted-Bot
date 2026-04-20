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
      // Oversample: filters (price / rating / review count) typically drop
      // 50-70% of cards, so grab 2× the cap to guarantee we hit it.
      const target = Math.max(opts.filters.max_per_query * 2, 40);
      const cards = await scrapeSearchResults(page, query, target);
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
          // Enrich card with FULL data from the detail page — the search
          // card only gives us a thumbnail + price. For proper AI listings
          // we need every image angle, the long-form description, and the
          // structured attributes (material, fit, care, sizing).
          const detail = await fetchDetailData(page, card.url, card.image_urls);
          const enriched: CrawledCard = { ...card, image_urls: detail.images };
          if (detail.detailTitle && detail.detailTitle.length > enriched.title.length) {
            enriched.title = detail.detailTitle.slice(0, 200);
          }
          log.info('Detail scraped', {
            goodsId: card.goodsId,
            images: detail.images.length,
            descriptionChars: detail.description.length,
            attributeCount: Object.keys(detail.attributes).length,
          });

          const saved = await persistCard(enriched, query, detail);
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

async function scrapeSearchResults(
  page: Page,
  query: string,
  targetCount: number,
): Promise<CrawledCard[]> {
  const merged = new Map<string, CrawledCard>();

  // Temu's search is infinite-scroll within a single URL, but they ALSO
  // accept a page query param (&page=N) that returns the N-th block of
  // results. We combine both: on each URL, scroll until cards stop
  // growing, then bump the page param. Stops when we hit targetCount,
  // max pages, or two consecutive empty pages.
  const MAX_PAGES = 8;
  let emptyPages = 0;

  for (let pageIdx = 1; pageIdx <= MAX_PAGES; pageIdx++) {
    const url = CRAWLER.searchUrl(query, pageIdx);
    log.info('Crawling page', { query, pageIdx, url, soFar: merged.size });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await page
      .locator('a[href*="-g-"][href*=".html"]')
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 })
      .catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

    const block = await isBotBlocked(page);
    if (block.blocked) {
      log.warn('Temu blocked on search', { query, reason: block.reason });
      break;
    }

    const sizeBefore = merged.size;
    const pageCards = await infiniteScrollExtract(page, targetCount - merged.size);
    for (const c of pageCards) {
      if (!merged.has(c.goodsId)) merged.set(c.goodsId, c);
    }
    const added = merged.size - sizeBefore;
    log.info('Page scrape done', {
      query,
      pageIdx,
      pageCards: pageCards.length,
      newUnique: added,
      total: merged.size,
    });

    if (merged.size >= targetCount) break;
    if (added === 0) {
      emptyPages++;
      if (emptyPages >= 2) break;
    } else {
      emptyPages = 0;
    }
    await sleep(1200 + Math.random() * 800);
  }

  if (merged.size === 0) {
    log.warn('No cards parsed — dumping diagnostic', {
      query,
      url: page.url(),
      title: await page.title().catch(() => ''),
    });
    return [];
  }

  return Array.from(merged.values());
}

/**
 * On the current page, scroll repeatedly until no new product cards appear
 * OR we have enough. Re-extracts after every scroll batch.
 */
async function infiniteScrollExtract(
  page: Page,
  wantMore: number,
): Promise<CrawledCard[]> {
  const perPageMap = new Map<string, CrawledCard>();
  let stagnantRounds = 0;
  const MAX_SCROLLS = 20;

  for (let scrollIdx = 0; scrollIdx < MAX_SCROLLS; scrollIdx++) {
    const cards = await extractVisibleCards(page);
    for (const c of cards) {
      if (!perPageMap.has(c.goodsId)) perPageMap.set(c.goodsId, c);
    }
    if (perPageMap.size >= wantMore) break;

    const sizeBeforeScroll = perPageMap.size;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await sleep(900 + Math.random() * 500);

    const afterScroll = await extractVisibleCards(page);
    for (const c of afterScroll) {
      if (!perPageMap.has(c.goodsId)) perPageMap.set(c.goodsId, c);
    }
    if (perPageMap.size === sizeBeforeScroll) {
      stagnantRounds++;
      if (stagnantRounds >= 3) break;
    } else {
      stagnantRounds = 0;
    }
  }

  return Array.from(perPageMap.values());
}

async function extractVisibleCards(page: Page): Promise<CrawledCard[]> {
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

      // Pick the BEST image in the card. Temu search cards contain:
      //   - 1x1 GIF tracking pixels
      //   - tiny LQIP blur placeholders (~800B AVIF)
      //   - the real product image (usually via srcset / currentSrc, often
      //     AVIF served by kwcdn.com / temu-img.com CDN)
      // Strategy: gather all img candidates, prefer currentSrc → highest
      // srcset entry → data-src → src. Filter out data: URIs, 1x1 pixels,
      // and obvious non-product glyphs (icons, flags).
      const imgUrl = (() => {
        const imgs = Array.from(card.querySelectorAll<HTMLImageElement>('img'));
        const candidates: Array<{ url: string; area: number }> = [];
        for (const im of imgs) {
          // Natural dimensions tell us if it's a real image (loaded) or a pixel
          const w = im.naturalWidth || im.width || 0;
          const h = im.naturalHeight || im.height || 0;
          if (w > 0 && w < 50 && h > 0 && h < 50) continue; // tracking pixel / icon
          // Build candidate URL list for THIS img
          const urls: string[] = [];
          if (im.currentSrc) urls.push(im.currentSrc);
          const srcset = im.getAttribute('srcset');
          if (srcset) {
            // srcset is "url 1x, url2 2x" or "url 400w, url2 800w"
            srcset.split(',').forEach((part) => {
              const u = part.trim().split(/\s+/)[0];
              if (u) urls.push(u);
            });
          }
          const dataSrc = im.getAttribute('data-src') ?? im.getAttribute('data-original');
          if (dataSrc) urls.push(dataSrc);
          if (im.src) urls.push(im.src);
          for (const u of urls) {
            if (!u || u.startsWith('data:')) continue;
            if (!/^https?:\/\//.test(u)) continue;
            // Prefer Temu / Kwcdn image CDN domains
            const isTemuCdn = /kwcdn\.com|temu-img\.com|temucdn\.com|temu\.com\/.*\.(jpg|jpeg|png|webp|avif)/i.test(u);
            const area = (w * h) || (isTemuCdn ? 10000 : 1);
            candidates.push({ url: u, area });
          }
        }
        if (candidates.length === 0) return null;
        // Largest area wins
        candidates.sort((a, b) => b.area - a.area);
        return candidates[0]!.url;
      })();

      const firstImg = card.querySelector<HTMLImageElement>('img');
      const title =
        (a.getAttribute('aria-label') ?? a.textContent ?? firstImg?.alt ?? '').trim();

      const fullText = (card.innerText ?? '').replace(/\s+/g, ' ').trim();
      // Best-effort extractors — Temu verified patterns (April 2026):
      //   Price:   "€17.57"
      //   Rating:  "4.8 von fünf Sternen"  (NOT just "4.8 Stern")
      //   Reviews: "657 Bewertungen"
      //   Sold:    "10Tsd.verkauft"
      const priceText = (fullText.match(/€\s*\d+[.,]\d{1,2}|\d+[.,]\d{1,2}\s*€/) ?? [null])[0];
      const ratingText =
        (fullText.match(
          /([0-5](?:[.,]\d)?)\s*(?:von\s+(?:fünf|5)\s+Stern|Stern|★|out of 5|\/\s*5)/i,
        ) ?? [null])[0];
      const reviewText =
        (fullText.match(
          /(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:Bewertungen|Rezensionen|reviews|ratings)/i,
        ) ?? [null])[0];

      out.push({
        goodsId,
        url: href,
        title: title.slice(0, 200),
        priceText,
        ratingText,
        reviewText,
        imgUrl,
      });
    });
    return out;
  });

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

// ── Detail-page data extraction ───────────────────────────────────────────────

export interface DetailData {
  images: string[];
  /** Long-form product description (paragraphs). */
  description: string;
  /** Flat key→value map of all "Produktdetails" attributes. */
  attributes: Record<string, string>;
  /** Full page title from detail page (usually better than search-card title). */
  detailTitle: string | null;
}

/**
 * Visit a Temu product detail page and pull everything useful:
 *   - full image gallery (main + thumbnails: front, side, back, detail)
 *   - long-form description text
 *   - structured attributes (material, fit, care, origin, …)
 *   - the detail-page title (often more descriptive than the card title)
 *
 * Falls back to the search-card image if the detail page fails entirely.
 *
 * Gallery strategy:
 *   1. Navigate to the detail URL and wait for it to settle.
 *   2. Click through thumbnails (forces lazy-load of each high-res image).
 *   3. Collect all CDN images that cluster on the same product-hash path
 *      (Temu groups each product's photos under one directory prefix).
 *   4. Dedupe by URL-without-resize, upgrade to 800×800, cap at 8.
 *
 * Description strategy:
 *   - Expand any "mehr anzeigen" / "show more" buttons first.
 *   - Collect the "Produktdetails" / "Beschreibung" section text.
 *   - Collect every "key: value" pair in that section as an attribute dict.
 */
async function fetchDetailData(
  page: Page,
  productUrl: string,
  fallback: string[],
): Promise<DetailData> {
  const empty: DetailData = {
    images: fallback,
    description: '',
    attributes: {},
    detailTitle: null,
  };
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => null);

    // Hover over each thumbnail to trigger the main-image swap → forces
    // the full gallery to download. Thumbnails are typically small imgs
    // in a scroll strip near the main image.
    await page
      .evaluate(async () => {
        const thumbs = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[class*="thumb" i] img, [class*="Thumb" i] img, [class*="preview" i] img',
          ),
        ).slice(0, 12);
        for (const t of thumbs) {
          try {
            t.scrollIntoView({ block: 'center' });
            t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            (t as HTMLElement).click();
            await new Promise((r) => setTimeout(r, 250));
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => null);
    // Scroll the whole page — lazy-loads thumbnails + description section
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 800);
      await sleep(500);
    }
    // Expand any "mehr anzeigen" / "show more" buttons in the description
    await page
      .evaluate(() => {
        const expanders = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"], a, span'),
        );
        const wanted = [
          'mehr anzeigen', 'mehr lesen', 'alle details', 'alle merkmale',
          'show more', 'read more', 'see more', 'view all',
        ];
        for (const el of expanders) {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (!t) continue;
          if (wanted.some((w) => t === w || t.startsWith(w))) {
            try {
              el.scrollIntoView({ block: 'center' });
              el.click();
            } catch {
              /* ignore */
            }
          }
        }
      })
      .catch(() => null);
    await sleep(600);

    const extracted = await page.evaluate(() => {
      // ── Images ──
      const imgOut: Array<{ url: string; area: number }> = [];
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
      for (const im of imgs) {
        const w = im.naturalWidth || im.width || 0;
        const h = im.naturalHeight || im.height || 0;
        if (w > 0 && w < 150 && h > 0 && h < 150) continue;
        const urls: string[] = [];
        if (im.currentSrc) urls.push(im.currentSrc);
        const srcset = im.getAttribute('srcset');
        if (srcset) {
          srcset.split(',').forEach((p) => {
            const u = p.trim().split(/\s+/)[0];
            if (u) urls.push(u);
          });
        }
        const ds = im.getAttribute('data-src') ?? im.getAttribute('data-original');
        if (ds) urls.push(ds);
        if (im.src) urls.push(im.src);
        for (const u of urls) {
          if (!u || u.startsWith('data:')) continue;
          if (!/^https?:\/\//.test(u)) continue;
          if (!/kwcdn\.com|temu-img\.com|temucdn\.com/i.test(u)) continue;
          const area = (w * h) || 10000;
          imgOut.push({ url: u, area });
        }
      }

      // ── Detail title ──
      const detailTitle =
        document.querySelector<HTMLElement>('h1')?.innerText?.trim() ??
        document.querySelector<HTMLElement>('[class*="title" i]')?.innerText?.trim() ??
        null;

      // ── Description + attributes ──
      // Temu uses section headings like "Produktdetails", "Artikelinformationen",
      // "Beschreibung", "Materialangaben" — scan the whole body for headings,
      // collect each section's following text as description_parts, and
      // collect any "Key: Value" pair inside them as attributes.
      const sectionKeywords = [
        'produktdetails', 'artikelinformationen', 'artikelinfo',
        'beschreibung', 'materialangaben', 'produktinformationen',
        'product details', 'description', 'specifications', 'material',
        'size information', 'größeninformationen', 'größenangaben',
      ];

      const descriptionParts: string[] = [];
      const attrs: Record<string, string> = {};

      // Find any element whose text STARTS with a section keyword — its
      // parent block typically contains the info.
      const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
      const seenSections = new Set<HTMLElement>();
      for (const el of all) {
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (!t) continue;
        if (t.length > 120) continue; // only heading-like elements
        const hit = sectionKeywords.find((k) => t === k || t.startsWith(k));
        if (!hit) continue;
        // Walk up 1-3 levels to get a container with actual content
        let container: HTMLElement | null = el.parentElement;
        for (let lvl = 0; lvl < 3 && container; lvl++) {
          const txt = (container.innerText || '').trim();
          if (txt.length > 60 && !seenSections.has(container)) {
            seenSections.add(container);
            descriptionParts.push(txt);
            break;
          }
          container = container.parentElement;
        }
      }

      // Also grab the meta description as a fallback
      const metaDesc =
        document
          .querySelector<HTMLMetaElement>('meta[name="description"]')
          ?.getAttribute('content') ?? '';
      if (metaDesc && metaDesc.length > 40) descriptionParts.push(metaDesc);

      // Attributes from "Key: Value" lines in description text
      const combined = descriptionParts.join('\n');
      const lines = combined.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        // "Material: Polyester 95%, Spandex 5%"
        const m = line.match(/^([A-Za-zÄÖÜäöüß \-/]{2,30})\s*[:：]\s*(.{2,200})$/);
        if (m && m[1] && m[2]) {
          const key = m[1].trim();
          const val = m[2].trim();
          if (!attrs[key]) attrs[key] = val;
        }
      }

      // Definition-list style attributes
      document.querySelectorAll('dl').forEach((dl) => {
        const dts = dl.querySelectorAll('dt');
        const dds = dl.querySelectorAll('dd');
        const n = Math.min(dts.length, dds.length);
        for (let i = 0; i < n; i++) {
          const k = (dts[i] as HTMLElement)?.innerText?.trim();
          const v = (dds[i] as HTMLElement)?.innerText?.trim();
          if (k && v && !attrs[k]) attrs[k] = v;
        }
      });

      // Dedupe + clean description
      const uniqueParts = Array.from(new Set(descriptionParts));
      const description = uniqueParts.join('\n\n').replace(/\n{3,}/g, '\n\n').slice(0, 5000);

      return { imgOut, detailTitle, description, attrs };
    });

    const raw = extracted.imgOut;
    if (raw.length === 0) {
      log.warn('Detail page: no CDN images found', { productUrl });
      return {
        images: fallback,
        description: extracted.description,
        attributes: extracted.attrs,
        detailTitle: extracted.detailTitle,
      };
    }

    // Cluster by URL prefix — a product's gallery lives under one path
    // like .../product/fancy/{hash}/..., so the largest cluster IS the
    // gallery. Unrelated page chrome / recommendations fall out.
    const prefixCount = new Map<string, typeof raw>();
    for (const c of raw) {
      const prefix = extractUrlPrefix(c.url);
      const arr = prefixCount.get(prefix) ?? [];
      arr.push(c);
      prefixCount.set(prefix, arr);
    }
    let bestPrefix = '';
    let bestCount = 0;
    for (const [p, arr] of prefixCount) {
      if (arr.length > bestCount) {
        bestCount = arr.length;
        bestPrefix = p;
      }
    }
    const cluster = prefixCount.get(bestPrefix) ?? [];

    // Dedupe by URL stripped of its /WxH/ resize segment
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of cluster.sort((a, b) => b.area - a.area)) {
      const key = c.url.replace(/\/\d{2,4}x\d{2,4}\//, '/');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(upgradeImageUrl(c.url));
      if (out.length >= 8) break;
    }

    return {
      images: out.length > 0 ? out : fallback,
      description: extracted.description,
      attributes: extracted.attrs,
      detailTitle: extracted.detailTitle,
    };
  } catch (err) {
    log.warn('Detail page fetch failed', {
      productUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

function extractUrlPrefix(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    // First 4 path segments uniquely identify a Temu product's image folder
    return `${u.origin}/${segs.slice(0, 4).join('/')}`;
  } catch {
    return url;
  }
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

async function persistCard(
  card: CrawledCard,
  query: string,
  detail?: DetailData,
): Promise<{
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
    description: detail?.description ?? '',
    attributes: detail?.attributes ?? {},
  };
  const { folderNum, folderPath, queuePath } = await materialiseProduct(product, downloadImages);

  // DB insert
  getDb()
    .prepare(
      `INSERT INTO crawled_products
         (temu_goods_id, temu_url, title, price_eur, rating, review_count,
          search_query, description, attributes_json,
          folder_num, folder_path, queue_file_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'crawled')`,
    )
    .run(
      card.goodsId,
      card.url,
      card.title,
      card.price_eur,
      card.rating,
      card.review_count,
      query,
      detail?.description ?? null,
      detail ? JSON.stringify(detail.attributes) : null,
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
