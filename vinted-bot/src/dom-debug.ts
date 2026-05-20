// ──────────────────────────────────────────────────────────────────────────────
// DOM Debug Helper — scrapes the page for *likely* elements when primary
// selectors fail. Used as a fallback by profile-scraper and trend-scraper,
// and exposed via the GET /api/dom-dump route for first-run selector tuning.
//
// The idea: Vinted's CSS classes are content-hashed and rename on every
// release, but the *visible text* and *href patterns* of UI elements are
// stable (because they're tied to the user-facing copy & routing). So when
// targeted selectors return NULL we sweep the DOM, find anything that
// matches a label heuristic (e.g. text contains "Follower" near a digit),
// and return ranked candidates with their CSS path + outer-html preview.
//
// Each candidate carries a `confidence` in [0..1]:
//   • 1.0   primary selector fired
//   • 0.7+  strong text-pattern match + parent-context match
//   • 0.5+  weak match (text alone)
//   • <0.5  too noisy to trust
//
// Callers (profile-scraper, trend-scraper) typically take confidence ≥ 0.7
// as a "use this value" signal, ≥ 0.5 as "log and persist", below as "drop".
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';

export interface DomCandidate {
  selector: string;
  text: string;
  outer_html_preview: string;
  confidence: number;
  /** Parsed numeric value if the heuristic was able to extract one. */
  value?: number | null;
  /** Optional href (e.g. for brand links). */
  href?: string | null;
}

export interface DomDump {
  url: string;
  scraped_at: string;
  followers_candidates: DomCandidate[];
  rating_candidates: DomCandidate[];
  wallet_candidates: DomCandidate[];
  brand_candidates: DomCandidate[];
  /** Search-bar / catalog-link candidates (used by trend-scraper). */
  search_candidates: DomCandidate[];
  raw_meta: { title: string; lang: string; bodyClass: string };
}

export interface DumpOptions {
  /** Limit which candidate sets are computed (default: all). */
  types?: Array<'followers' | 'rating' | 'wallet' | 'brand' | 'search'>;
  /** Max candidates per type (default 10). */
  perType?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// In-page sweep. We do all the work in one page.evaluate() because round-
// tripping handles for every element is slow on a profile/wallet page that
// can have hundreds of nodes.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run the candidate sweep inside the page. Pure browser-side, returns
 * already-serialized {selector, text, outer_html_preview, confidence, …}
 * arrays so we don't need to evaluate handles individually.
 */
async function sweep(page: Page, perType: number): Promise<{
  followers: DomCandidate[];
  rating: DomCandidate[];
  wallet: DomCandidate[];
  brand: DomCandidate[];
  search: DomCandidate[];
  meta: { title: string; lang: string; bodyClass: string };
}> {
  return page.evaluate((max) => {
    // ── CSS-path builder ─────────────────────────────────────────────────
    // Builds a short, deterministic CSS selector for an element. Prefers
    // [data-testid] when present, falls back to tag + first class token +
    // nth-of-type so the selector is unique enough to inspect manually but
    // not so brittle that it copies generated class hashes.
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 4) {
        const testId = node.getAttribute('data-testid');
        if (testId) {
          parts.unshift(`[data-testid="${testId}"]`);
          break; // testid is unique enough on its own
        }
        const tag = node.tagName.toLowerCase();
        const cls = (node.className && typeof node.className === 'string')
          ? node.className.split(/\s+/).filter((c) => c && !/^_?[a-zA-Z0-9]{6,}$/.test(c))[0]
          : null;
        // ^ skip hashed class names (e.g. "MWFh3", "_5kRkmA") — they're
        //   not stable. Only keep "human" class tokens.
        let part = tag;
        if (cls) part += `.${cls}`;
        // Add :nth-of-type only when no class — keeps short selectors short.
        if (!cls && node.parentElement) {
          const sib = Array.from(node.parentElement.children).filter(
            (c) => c.tagName === node!.tagName,
          );
          if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = node.parentElement;
        depth++;
      }
      return parts.join(' > ');
    }

    function preview(el: Element): string {
      try {
        const html = el.outerHTML || '';
        return html.length > 200 ? html.slice(0, 200) + '…' : html;
      } catch {
        return '';
      }
    }

    function cleanText(s: string | null | undefined): string {
      if (!s) return '';
      return String(s).replace(/\s+/g, ' ').trim().slice(0, 240);
    }

    // ── Followers / Following ────────────────────────────────────────────
    // Pattern: number-near-the-word-Follower (DE/EN/FR), or anchors to
    // /followers / /following URLs.
    const followersOut: DomCandidate[] = [];
    {
      const re = /(\d[\d.,\s]*)\s*(folgen|follower|fans|fan)/i;
      // Anchors to /followers are the strongest signal.
      const anchors = Array.from(document.querySelectorAll('a[href*="/followers"], a[href*="/following"], a[href*="/fans"]'));
      for (const a of anchors) {
        const txt = cleanText((a as HTMLElement).innerText || a.textContent);
        if (!txt) continue;
        const m = txt.match(re) || txt.match(/(\d[\d.,\s]*)/);
        const numRaw = m && m[1] ? m[1] : null;
        const value = numRaw ? parseInt(numRaw.replace(/[^0-9]/g, ''), 10) : null;
        followersOut.push({
          selector: cssPath(a),
          text: txt,
          outer_html_preview: preview(a),
          confidence: 0.9,
          value: Number.isFinite(value) ? value : null,
          href: (a as HTMLAnchorElement).href || null,
        });
      }
      // Fallback: any element whose direct text contains "N Follower".
      if (followersOut.length < max) {
        const all = Array.from(document.querySelectorAll('span, div, a, button'));
        for (const el of all) {
          const txt = cleanText((el as HTMLElement).innerText || el.textContent);
          if (!txt || txt.length > 80) continue;
          const m = txt.match(re);
          if (!m) continue;
          const value = m[1] ? parseInt(m[1].replace(/[^0-9]/g, ''), 10) : null;
          followersOut.push({
            selector: cssPath(el),
            text: txt,
            outer_html_preview: preview(el),
            confidence: 0.7,
            value: Number.isFinite(value) ? value : null,
          });
          if (followersOut.length >= max) break;
        }
      }
    }

    // ── Rating ───────────────────────────────────────────────────────────
    // Pattern: "4,8 (123 Bewertungen)" or aria-label="Bewertung 4.8 von 5".
    const ratingOut: DomCandidate[] = [];
    {
      const re = /(\d[.,]\d)/;
      const all = Array.from(document.querySelectorAll('span, div, button, [aria-label]'));
      for (const el of all) {
        const aria = (el.getAttribute('aria-label') || '').trim();
        const txt = cleanText((el as HTMLElement).innerText || el.textContent);
        const blob = `${aria} ${txt}`;
        if (!re.test(blob)) continue;
        // Must look ratey: parent context mentions Bewertung/Rating/Sterne, or
        // the same element carries a 0-5 decimal and (count).
        const looksRatey =
          /bewertung|rating|sterne|stars|note/i.test(blob) ||
          /\(\s*\d+\s*\)/.test(blob);
        if (!looksRatey) continue;
        const m = blob.match(re);
        const value = m && m[1] ? parseFloat(m[1].replace(',', '.')) : null;
        if (!Number.isFinite(value) || value === null || value < 0 || value > 5) continue;
        const conf = /bewertung|rating|sterne|stars|note/i.test(blob) ? 0.85 : 0.6;
        ratingOut.push({
          selector: cssPath(el),
          text: txt || aria,
          outer_html_preview: preview(el),
          confidence: conf,
          value,
        });
        if (ratingOut.length >= max) break;
      }
    }

    // ── Wallet / Saldo / Guthaben ────────────────────────────────────────
    // Pattern: amount with € sign, inside a context mentioning Saldo /
    // Wallet / Guthaben / Balance.
    const walletOut: DomCandidate[] = [];
    {
      const re = /([0-9]+[.,]?[0-9]*)\s*€/;
      const all = Array.from(document.querySelectorAll('span, div, h1, h2, h3, p'));
      for (const el of all) {
        const txt = cleanText((el as HTMLElement).innerText || el.textContent);
        if (!txt || txt.length > 120) continue;
        if (!re.test(txt)) continue;
        // Parent / ancestor context — walk up 3 levels checking for the keyword.
        let ctx = '';
        let node: Element | null = el;
        for (let i = 0; i < 4 && node; i++) {
          ctx += ' ' + cleanText((node as HTMLElement).innerText || '').slice(0, 200);
          node = node.parentElement;
        }
        const looksWallety = /saldo|wallet|balance|guthaben|verfügbar|verdient/i.test(ctx);
        if (!looksWallety) continue;
        const m = txt.match(re);
        const value = m && m[1] ? parseFloat(m[1].replace(',', '.').replace(/[^0-9.]/g, '')) : null;
        if (!Number.isFinite(value) || value === null) continue;
        // Confidence higher if the element's own text *starts* with the value
        // (i.e. it's the headline, not a transaction row).
        const own = (el as HTMLElement).innerText || el.textContent || '';
        const isHeadline = re.test(own.trim().slice(0, 32));
        walletOut.push({
          selector: cssPath(el),
          text: txt,
          outer_html_preview: preview(el),
          confidence: isHeadline ? 0.85 : 0.55,
          value,
        });
        if (walletOut.length >= max * 2) break;
      }
      // Best-headline first.
      walletOut.sort((a, b) => b.confidence - a.confidence);
      walletOut.splice(max);
    }

    // ── Brand candidates ─────────────────────────────────────────────────
    const brandOut: DomCandidate[] = [];
    {
      const anchors = Array.from(document.querySelectorAll('a[href*="/brand/"]'));
      const seen = new Set<string>();
      for (const a of anchors) {
        const txt = cleanText((a as HTMLElement).innerText || a.textContent);
        if (!txt) continue;
        const key = txt.toLowerCase().split('\n')[0]?.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        brandOut.push({
          selector: cssPath(a),
          text: txt.split('\n')[0] || txt,
          outer_html_preview: preview(a),
          confidence: 0.85,
          href: (a as HTMLAnchorElement).href || null,
        });
        if (brandOut.length >= max) break;
      }
    }

    // ── Search / catalog-link candidates (for trend-scraper) ─────────────
    const searchOut: DomCandidate[] = [];
    {
      const anchors = Array.from(document.querySelectorAll(
        'a[href*="search_text="], a[href*="/catalog?search_text="], a[href*="/search"]',
      ));
      const seen = new Set<string>();
      for (const a of anchors) {
        const txt = cleanText((a as HTMLElement).innerText || a.textContent);
        if (!txt) continue;
        const key = txt.toLowerCase().split('\n')[0]?.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        searchOut.push({
          selector: cssPath(a),
          text: txt.split('\n')[0] || txt,
          outer_html_preview: preview(a),
          confidence: 0.8,
          href: (a as HTMLAnchorElement).href || null,
        });
        if (searchOut.length >= max) break;
      }
    }

    const meta = {
      title: document.title || '',
      lang: document.documentElement?.getAttribute('lang') || '',
      bodyClass: document.body?.className || '',
    };

    return {
      followers: followersOut.slice(0, max),
      rating: ratingOut.slice(0, max),
      wallet: walletOut.slice(0, max),
      brand: brandOut.slice(0, max),
      search: searchOut.slice(0, max),
      meta,
    };
  }, perType);
}

/**
 * Dump probable elements for the labels we care about. Best-effort —
 * returns empty candidate-arrays if the page is unreachable.
 */
export async function dumpDom(page: Page, opts: DumpOptions = {}): Promise<DomDump> {
  const perType = opts.perType ?? 10;
  const want = new Set(opts.types ?? ['followers', 'rating', 'wallet', 'brand', 'search']);

  let result;
  try {
    result = await sweep(page, perType);
  } catch {
    result = {
      followers: [], rating: [], wallet: [], brand: [], search: [],
      meta: { title: '', lang: '', bodyClass: '' },
    };
  }

  return {
    url: page.url(),
    scraped_at: new Date().toISOString(),
    followers_candidates: want.has('followers') ? result.followers : [],
    rating_candidates: want.has('rating') ? result.rating : [],
    wallet_candidates: want.has('wallet') ? result.wallet : [],
    brand_candidates: want.has('brand') ? result.brand : [],
    search_candidates: want.has('search') ? result.search : [],
    raw_meta: result.meta,
  };
}

/**
 * Pick the top-confidence candidate above a threshold. Returns null if
 * none qualifies.
 */
export function pickTop(
  candidates: DomCandidate[],
  minConfidence = 0.7,
): DomCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top || top.confidence < minConfidence) return null;
  return top;
}
