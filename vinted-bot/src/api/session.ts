// ──────────────────────────────────────────────────────────────────────────────
// Vinted-API Session-Extraktor
//
// Holt Cookies aus dem Playwright-persistent-Context und CSRF-Token von
// einer GET-Request gegen Vinted-Hauptseite. Ergebnis ist ein "Headers-Bag",
// den unser API-Client allen Requests mitgibt.
//
// Kein offizieller API-Token — Vinted's interne API authenticated mit den
// gleichen Cookies, die der Browser-Login setzt. Solange der User
// eingeloggt ist, kann der API-Client aufrufen.
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import { createLogger } from '@vinted-system/shared';

const log = createLogger('vinted-api-session');

const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

export interface VintedSession {
  cookieHeader: string;             // ready-to-send 'Cookie:' header value
  csrfToken: string | null;
  userAgent: string;
  baseUrl: string;
}

/** Wandelt Playwright-Cookie-Array in 'a=b; c=d' Header-String. */
function buildCookieHeader(cookies: Array<{ name: string; value: string; domain?: string }>): string {
  return cookies
    .filter((c) => !c.domain || c.domain.includes('vinted'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Versucht 3 Strategien um den CSRF-Token zu kriegen:
 *  1. `XSRF-TOKEN` Cookie (vinted nutzt das oft)
 *  2. `<meta name="csrf-token">` aus der Hauptseite (Rails-Stil)
 *  3. GET /api/v2/security/csrf_token (manche Vinted-Versionen)
 */
async function discoverCsrfToken(
  ctx: BrowserContext,
  cookieHeader: string,
  userAgent: string,
): Promise<string | null> {
  // Strategie 1: XSRF-TOKEN Cookie
  const cookies = await ctx.cookies(BASE_URL);
  const xsrf = cookies.find((c) => c.name === 'XSRF-TOKEN' || c.name === 'X-CSRF-Token');
  if (xsrf?.value) {
    log.info('CSRF token from cookie', { name: xsrf.name });
    return decodeURIComponent(xsrf.value);
  }

  // Strategie 2: meta tag aus Hauptseite holen
  try {
    const r = await fetch(`${BASE_URL}/`, {
      headers: {
        cookie: cookieHeader,
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const html = await r.text();
      const meta = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
      if (meta?.[1]) {
        log.info('CSRF token from <meta>');
        return meta[1];
      }
      const inline = html.match(/"csrfToken"\s*:\s*"([^"]+)"/);
      if (inline?.[1]) {
        log.info('CSRF token from JSON inline');
        return inline[1];
      }
    }
  } catch (err) {
    log.warn('csrf via meta failed', { err: String(err) });
  }

  // Strategie 3: dedizierter Endpoint
  try {
    const r = await fetch(`${BASE_URL}/api/v2/security/csrf_token`, {
      headers: {
        cookie: cookieHeader,
        'user-agent': userAgent,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { token?: string; csrf_token?: string };
      const token = j.token ?? j.csrf_token;
      if (token) {
        log.info('CSRF token from /api/v2/security/csrf_token');
        return token;
      }
    }
  } catch { /* */ }

  log.warn('No CSRF token discovered — POST/PUT/DELETE may fail');
  return null;
}

export async function extractVintedSession(ctx: BrowserContext): Promise<VintedSession> {
  const cookies = await ctx.cookies(BASE_URL);
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    throw new Error('No vinted cookies — user not logged in?');
  }

  // UA aus Context (deterministischer Per-Account-Fingerprint)
  const userAgent = await ctx.newPage()
    .then(async (p) => {
      try { return (await p.evaluate(() => navigator.userAgent)) as string; }
      finally { await p.close().catch(() => null); }
    })
    .catch(() => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const csrfToken = await discoverCsrfToken(ctx, cookieHeader, userAgent);

  return { cookieHeader, csrfToken, userAgent, baseUrl: BASE_URL };
}

/** Standard-Headers für authenticated API-Requests. */
export function authHeaders(session: VintedSession, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    cookie: session.cookieHeader,
    'user-agent': session.userAgent,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8',
    referer: `${session.baseUrl}/`,
    origin: session.baseUrl,
    ...extra,
  };
  if (session.csrfToken) {
    h['x-csrf-token'] = session.csrfToken;
    h['x-xsrf-token'] = session.csrfToken;
  }
  return h;
}
