// ──────────────────────────────────────────────────────────────────────────────
// Temu search-result & product-page selectors (crawler mode).
//
// These are best-effort. Temu's DOM changes constantly; the crawler logs
// diagnostic info on zero results so we can quickly adjust.
// ──────────────────────────────────────────────────────────────────────────────

export const CRAWLER = {
  // ── Search page ─────────────────────────────────────────────────────────
  searchUrl: (query: string, page = 1) => {
    const base = `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}`;
    return page > 1 ? `${base}&page=${page}` : base;
  },

  // Search-result product cards
  productCard: [
    '[data-goods-id]',
    'a[href*="-g-"][href$=".html"]',
    'div.goods-card',
  ].join(', '),

  // Individual card subparts
  cardImage: 'img',
  cardTitle: '[class*="title"], a[aria-label]',
  cardPrice: '[class*="price"]',
  cardRating: '[class*="rating"], [aria-label*="Stern"], [aria-label*="star" i]',
  cardReviewCount: '[class*="review"], [class*="sold"]',

  // ── Product-detail page ────────────────────────────────────────────────
  detailTitle: 'h1, [class*="title"]',
  detailPrice: '[class*="_priceSimple"], [class*="price"]',
  detailRating: '[class*="rate"], [aria-label*="Bewertung"]',
  detailReviewCount: '[class*="reviewCount"], [class*="review-count"]',
  detailMainImage: 'img[src*="kwcdn"]',
  detailGalleryImages: 'img[src*="kwcdn"]',
} as const;
