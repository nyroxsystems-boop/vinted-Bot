// ──────────────────────────────────────────────────────────────────────────────
// Profile Scraper — extracts account-level KPIs from Vinted.
//
// Scrapes the logged-in user's profile + wallet page once per call:
//   • followers / following  → top of profile page
//   • rating_avg + count     → star widget on profile page
//   • verified               → "Verifiziert" / "Verified" badge
//   • wallet_eur             → /wallet page (Vinted Saldo)
//   • warnings[]             → bot-side observations (captcha, rate-limit, …)
//
// All selectors are BEST-GUESS based on Vinted's current public profile
// layout. They DO NOT carry data-testid stability guarantees from Vinted —
// expect the locators to break when Vinted ships a redesign. If everything
// fails the function returns NULLs and the worker writes the partial row.
//
// Heuristic strategy: try several selector forms, then fall back to text-
// extraction via regex against the rendered page text. This survives most
// DOM reshufflings as long as the localized labels ("Bewertungen", "Folgt
// dir", "€-Saldo") stick around.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  requireAccount,
  getAccount,
  isBotBlocked,
} from '@vinted-system/shared';
import { getVintedBrowser } from './browser.js';
import { requireLogin } from './auth.js';
import { dumpDom, pickTop } from './dom-debug.js';

const log = createLogger('vinted-profile-scraper');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

/**
 * Confidence-score recorded per scraped field. Allows the caller to surface
 * "this number is a guess" in the dashboard. Values come from dom-debug's
 * heuristic ranker: 1.0 = primary selector fired, 0.7+ = fallback candidate
 * with strong context match, < 0.5 = dropped to NULL.
 */
export interface FieldConfidence {
  followers?: number;
  following?: number;
  rating?: number;
  wallet?: number;
}

export interface ProfileStats {
  followers: number | null;
  following: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  verified: boolean;
  wallet_eur: number | null;
  warnings: string[];
  /** 0..1 per field — 1.0 means primary selector hit; missing = not attempted. */
  confidence?: FieldConfidence;
}

/** Parse a German/English number with potential thousands separators ("1.234" or "1,234"). */
function parseLooseInt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Strip everything except digits, dots, commas.
  const clean = String(raw).replace(/[^\d.,]/g, '');
  if (!clean) return null;
  // Treat both "." and "," as thousands separators in this context — Vinted
  // doesn't show decimal followers.
  const stripped = clean.replace(/[.,]/g, '');
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse a German/English decimal like "4,8" or "4.8" or "142,80 €". */
function parseLooseFloat(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Pick the first number-like token; prefer German comma decimals.
  const m = String(raw).match(/(\d{1,4}(?:[.,]\d{1,2})?)/);
  if (!m || !m[1]) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function tryText(page: Page, selectors: string[], timeoutMs = 1500): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      // Don't wait long — best-effort, fall through if not present.
      const visible = await loc.isVisible({ timeout: timeoutMs }).catch(() => false);
      if (!visible) continue;
      const txt = (await loc.innerText({ timeout: timeoutMs }).catch(() => '')).trim();
      if (txt) return txt;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Try to read follower / rating / verified info from the profile page.
 * TODO: confirm exact selectors against a real logged-in profile. Current
 * guesses are based on Vinted's public profile DOM (March 2026 spot-check).
 */
async function scrapeProfilePage(page: Page, username: string | null, warnings: string[], confidence: FieldConfidence): Promise<{
  followers: number | null;
  following: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  verified: boolean;
}> {
  // Prefer the canonical profile URL with the username when we have it.
  // /member/<username> is the public profile; /member/general/profile is
  // the user's own settings page (different DOM, no follower count).
  const urls = username
    ? [`${BASE_URL}/member/${encodeURIComponent(username)}`, `${BASE_URL}/member/general/profile`]
    : [`${BASE_URL}/member/general/profile`];

  let opened = false;
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => null);
      opened = true;
      break;
    } catch (err) {
      log.warn('profile goto failed', { url, err: err instanceof Error ? err.message : String(err) });
    }
  }
  if (!opened) {
    warnings.push('profile_page_unreachable');
    return { followers: null, following: null, rating_avg: null, rating_count: null, verified: false };
  }

  // Check for bot-block / captcha first — if hit, bail with warning.
  const block = await isBotBlocked(page).catch(() => ({ blocked: false, reason: '' }));
  if (block.blocked) {
    warnings.push(`captcha_or_block:${block.reason || 'unknown'}`);
  }

  // ── Followers / Following ───────────────────────────────────────────────
  // TODO: confirm against live DOM. Likely candidates:
  //   • <a href="/member/<id>/followers">N Follower:innen</a>
  //   • [data-testid="profile-followers-count"]
  //   • role="link" containing the word "Follower" + a digit
  const followersText = await tryText(page, [
    '[data-testid="followers-count"]',
    '[data-testid="profile-followers"]',
    'a[href*="/followers"]',
    'text=/\\d+\\s*(Follower|follower)/i',
  ]);
  const followingText = await tryText(page, [
    '[data-testid="following-count"]',
    '[data-testid="profile-following"]',
    'a[href*="/following"]',
    'text=/\\d+\\s*(Folgt|following)/i',
  ]);

  // ── Rating ──────────────────────────────────────────────────────────────
  // Vinted shows star widget + "X,X (N Bewertungen)". Pull the numbers from
  // the page text as a final fallback.
  let ratingAvg: number | null = null;
  let ratingCount: number | null = null;
  const ratingText = await tryText(page, [
    '[data-testid="user-rating"]',
    '[data-testid="profile-rating"]',
    '[aria-label*="Bewertung" i]',
    '[aria-label*="rating" i]',
    'text=/\\d[.,]\\d.*\\(\\d+/i',
  ]);
  if (ratingText) {
    ratingAvg = parseLooseFloat(ratingText);
    const countMatch = ratingText.match(/\((\d+)/);
    if (countMatch && countMatch[1]) ratingCount = parseInt(countMatch[1], 10);
  }
  // Fallback: search the full rendered body for "X,X (N Bewertungen)".
  if (ratingAvg === null || ratingCount === null) {
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const m = body.match(/(\d[.,]\d)\s*[•·\(]?\s*\(?(\d+)\s*(Bewertung|review|Sternebewertung)/i);
    if (m && m[1] && m[2]) {
      ratingAvg = ratingAvg ?? parseLooseFloat(m[1]);
      ratingCount = ratingCount ?? parseInt(m[2], 10);
    }
  }

  // ── Verified ────────────────────────────────────────────────────────────
  // Vinted shows a small badge (envelope/phone tick) next to verified users.
  // TODO: confirm selectors. Best guesses:
  const verified = await page.locator(
    '[data-testid*="verified" i], [aria-label*="verified" i], [aria-label*="verifiziert" i], svg[aria-label*="verifiziert" i]',
  ).count().then((n) => n > 0).catch(() => false);

  // Parse primary-selector results.
  let followers = parseLooseInt(followersText);
  let following = parseLooseInt(followingText);

  // Primary-selector hits get confidence 1.0; we override below if we had to
  // fall back to dom-debug.
  if (followers !== null) confidence.followers = 1.0;
  if (following !== null) confidence.following = 1.0;
  if (ratingAvg !== null) confidence.rating = 1.0;

  // ── Fallback: dom-debug sweep ────────────────────────────────────────────
  // If primary selectors missed any field, dump the DOM and look for likely
  // candidates by text-pattern + parent-context match. Log loudly so the
  // user can see in /api/dom-dump output which selector to add upstream.
  const needFollowers = followers === null;
  const needRating = ratingAvg === null;
  if (needFollowers || needRating) {
    const dump = await dumpDom(page, {
      types: [
        ...(needFollowers ? (['followers'] as const) : []),
        ...(needRating ? (['rating'] as const) : []),
      ],
      perType: 8,
    }).catch(() => null);
    if (dump) {
      if (needFollowers) {
        const top = pickTop(dump.followers_candidates, 0.7);
        if (top && typeof top.value === 'number' && Number.isFinite(top.value)) {
          followers = top.value;
          confidence.followers = top.confidence;
          log.warn('Primary follower selector failed — using dom-debug candidate', {
            selector: top.selector,
            text: top.text,
            confidence: top.confidence,
          });
        } else if (dump.followers_candidates.length > 0) {
          log.warn('Follower candidates found but confidence below threshold', {
            top: dump.followers_candidates[0],
          });
        }
      }
      if (needRating) {
        const top = pickTop(dump.rating_candidates, 0.7);
        if (top && typeof top.value === 'number' && Number.isFinite(top.value)) {
          ratingAvg = top.value;
          confidence.rating = top.confidence;
          log.warn('Primary rating selector failed — using dom-debug candidate', {
            selector: top.selector,
            text: top.text,
            confidence: top.confidence,
          });
        } else if (dump.rating_candidates.length > 0) {
          log.warn('Rating candidates found but confidence below threshold', {
            top: dump.rating_candidates[0],
          });
        }
      }
    }
  }

  return {
    followers,
    following,
    rating_avg: ratingAvg,
    rating_count: ratingCount,
    verified,
  };
}

/**
 * Try to read wallet balance from /wallet (or its current localized path).
 * TODO: confirm exact URL — /wallet, /balance, or /member/wallet may all
 * redirect. We try the first that loads.
 */
async function scrapeWallet(page: Page, warnings: string[], confidence: FieldConfidence): Promise<number | null> {
  const candidates = [
    `${BASE_URL}/wallet`,
    `${BASE_URL}/member/wallet`,
    `${BASE_URL}/balance`,
  ];

  let opened = false;
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => null);
      const u = page.url();
      // If Vinted bounced us to /404 or /login, try the next candidate.
      if (/\/(404|login|signup)/i.test(u)) continue;
      opened = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!opened) {
    warnings.push('wallet_page_unreachable');
    return null;
  }

  // TODO: confirm selectors on live wallet page. Best guesses:
  const balanceText = await tryText(page, [
    '[data-testid="wallet-balance"]',
    '[data-testid="balance-amount"]',
    '[data-testid="wallet-amount"]',
    'h1:has-text("€")',
    'text=/Saldo|Balance|Guthaben/i',
  ], 2500);

  // Final fallback: scrape any € amount from the body and pick the largest
  // standalone monetary value. Risky on a wallet page that lists transactions,
  // so we only use this if the targeted selectors return nothing.
  let wallet = parseLooseFloat(balanceText);
  if (wallet !== null) {
    confidence.wallet = 1.0;
  }

  // ── Fallback: dom-debug sweep ────────────────────────────────────────────
  // Primary selectors missed. Look for any "€" amount near a Saldo/Wallet/
  // Guthaben/Balance label — heuristic in dom-debug.ts already excludes
  // transaction rows by preferring elements that *start* with the value.
  if (wallet === null) {
    const dump = await dumpDom(page, { types: ['wallet'], perType: 8 }).catch(() => null);
    if (dump) {
      const top = pickTop(dump.wallet_candidates, 0.7);
      if (top && typeof top.value === 'number' && Number.isFinite(top.value)) {
        wallet = top.value;
        confidence.wallet = top.confidence;
        log.warn('Primary wallet selector failed — using dom-debug candidate', {
          selector: top.selector,
          text: top.text,
          confidence: top.confidence,
        });
      } else if (dump.wallet_candidates.length > 0) {
        log.warn('Wallet candidates found but confidence below threshold', {
          top: dump.wallet_candidates[0],
        });
      }
    }

    // Last-ditch: pure regex sweep of body text. Only kept for backwards
    // compat; dom-debug should subsume this in practice.
    if (wallet === null) {
      const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      const m = body.match(/([\d.,]+)\s*€/);
      if (m) {
        wallet = parseLooseFloat(m[1]);
        if (wallet !== null) confidence.wallet = 0.4; // very low — body-wide regex
      }
    }
  }

  // Drop very-low-confidence values rather than persisting noise.
  if (wallet !== null && (confidence.wallet ?? 0) < 0.5) {
    log.warn('Dropping wallet value — confidence below 0.5', { value: wallet, confidence: confidence.wallet });
    delete confidence.wallet;
    return null;
  }

  return wallet;
}

/**
 * Scrape all profile-level stats for an account. Best-effort: on any
 * unreachable section we return NULL for those fields + push a warning
 * string. The orchestrator's account-metrics-collector merges these with
 * DB-aggregates (sales/views/likes) before persisting.
 */
export async function scrapeProfileStats(accountId: number): Promise<ProfileStats> {
  requireAccount(accountId);
  const account = getAccount(accountId);
  const warnings: string[] = [];
  const confidence: FieldConfidence = {};

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();

  let profile = {
    followers: null as number | null,
    following: null as number | null,
    rating_avg: null as number | null,
    rating_count: null as number | null,
    verified: false,
  };
  let wallet_eur: number | null = null;

  try {
    await requireLogin(page, accountId);
    profile = await scrapeProfilePage(page, account?.username ?? null, warnings, confidence);
    wallet_eur = await scrapeWallet(page, warnings, confidence);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not authenticated|login|session expired|unauthorized/i.test(msg)) {
      warnings.push('not_authenticated');
    } else {
      warnings.push(`scrape_error:${msg.slice(0, 80)}`);
    }
    log.warn('Profile scrape failed', { accountId, error: msg });
  } finally {
    await page.close().catch(() => null);
  }

  // Surface a "low confidence" warning if any value was a fallback-guess.
  // The dashboard can pick this up and show a yellow badge so the user knows
  // the number is approximate until selectors are tuned upstream.
  const lowConfFields = (Object.entries(confidence) as Array<[keyof FieldConfidence, number]>)
    .filter(([, c]) => c < 1.0)
    .map(([k]) => k);
  if (lowConfFields.length > 0) {
    warnings.push(`low_confidence:${lowConfFields.join(',')}`);
  }

  return {
    ...profile,
    wallet_eur,
    warnings,
    confidence: Object.keys(confidence).length > 0 ? confidence : undefined,
  };
}
