// ──────────────────────────────────────────────────────────────────────────────
// eBay OAuth2 access-token cache per marketplace.
//
// Credential-lookup precedence for `getAccessToken(market, accountId?)`:
//   1) ebay_account_tokens(account_id, marketplace)        — per-account (when accountId given)
//   2) settings `ebay_<market>_<kind>`                     — legacy per-market
//   3) settings `ebay_<kind>`                              — legacy shared
//   4) env `EBAY_<MARKET>_<KIND>` / `EBAY_<KIND>`          — env fallback
//
// A short-lived access-token (~2 h) is cached:
//   • per-account → persisted in `ebay_account_tokens.access_token`
//   • legacy      → in-process Map (no accountId)
//
// On 401 the caller invalidates the right cache slot via
// `invalidateAccessToken(accountId, marketplace)` (per-account) or
// `invalidateToken(market)` (legacy) and retries once.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getSetting,
  getEbayTokens,
  updateAccessToken,
  invalidateAccessToken as invalidateAccountAccessToken,
} from '@vinted-system/shared';

const log = createLogger('ebay-token');

export type EbayMarket = 'de' | 'uk';
export type EbayMarketplaceId = 'EBAY_DE' | 'EBAY_GB';

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
].join(' ');

function isSandbox(): boolean {
  const dbVal = getSetting('ebay_sandbox');
  if (dbVal === 'true') return true;
  if (dbVal === 'false') return false;
  return process.env.EBAY_SANDBOX === 'true';
}

export function ebayApiBase(): string {
  return isSandbox() ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

function authUrl(): string {
  return `${ebayApiBase()}/identity/v1/oauth2/token`;
}

export function marketplaceId(market: EbayMarket): EbayMarketplaceId {
  return market === 'uk' ? 'EBAY_GB' : 'EBAY_DE';
}

export function contentLanguage(market: EbayMarket): string {
  return market === 'uk' ? 'en-GB' : 'de-DE';
}

export function currencyOf(market: EbayMarket): 'EUR' | 'GBP' {
  return market === 'uk' ? 'GBP' : 'EUR';
}

function readCred(market: EbayMarket, kind: 'client_id' | 'client_secret' | 'refresh_token'): string {
  // 1) ebay_de_<kind>  / ebay_uk_<kind>
  const perMarket = getSetting(`ebay_${market}_${kind}`);
  if (perMarket && perMarket.length > 0) return perMarket;

  // 2) ebay_<kind>  (shared across both markets — what orchestrator already uses)
  const shared = getSetting(`ebay_${kind}`);
  if (shared && shared.length > 0) return shared;

  // 3) env per-market
  const envPerMarket = process.env[`EBAY_${market.toUpperCase()}_${kind.toUpperCase()}`];
  if (envPerMarket && envPerMarket.length > 0) return envPerMarket;

  // 4) env shared
  return process.env[`EBAY_${kind.toUpperCase()}`] ?? '';
}

interface CachedToken {
  token: string;
  expiresAt: number;  // epoch ms
}

const cache = new Map<EbayMarket, CachedToken>();

export function invalidateToken(market: EbayMarket): void {
  cache.delete(market);
}

export interface CredentialCheck {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function readCredentials(market: EbayMarket): CredentialCheck {
  return {
    clientId: readCred(market, 'client_id'),
    clientSecret: readCred(market, 'client_secret'),
    refreshToken: readCred(market, 'refresh_token'),
  };
}

export function hasCredentials(market: EbayMarket): boolean {
  const { clientId, clientSecret, refreshToken } = readCredentials(market);
  return !!(clientId && clientSecret && refreshToken);
}

/** Map our 'de'|'uk' shorthand onto the `ebay_account_tokens.marketplace`
 *  enum. */
function marketKey(market: EbayMarket): 'ebay_de' | 'ebay_uk' {
  return market === 'uk' ? 'ebay_uk' : 'ebay_de';
}

function parseIso(ts?: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/** Acquire an eBay OAuth access-token.
 *
 *  • `accountId` given → look in `ebay_account_tokens` first; if a stored
 *    `client_id` exists, use that row's credentials and persist the new
 *    `access_token` back into the table for the next call.
 *  • `accountId` omitted (or row has no `client_id`) → fall through to the
 *    legacy settings/env chain via `readCredentials()` and the in-process
 *    cache. This preserves backward-compat for the original single-credential
 *    setup. */
export async function getAccessToken(market: EbayMarket, accountId?: number): Promise<string> {
  // ── Per-account path ───────────────────────────────────────────────────────
  if (accountId != null) {
    const mp = marketKey(market);
    const stored = getEbayTokens(accountId, mp);
    if (stored?.client_id && stored.client_secret && stored.refresh_token) {
      const expiresAt = parseIso(stored.access_expires_at ?? null);
      if (stored.access_token && expiresAt && Date.now() < expiresAt - 60_000) {
        return stored.access_token;
      }
      // Refresh via the row's own credentials.
      const credentials = Buffer.from(`${stored.client_id}:${stored.client_secret}`).toString('base64');
      const res = await fetch(authUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: stored.refresh_token,
          scope: SCOPES,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`eBay ${market.toUpperCase()} (account ${accountId}) token refresh failed: ${res.status} ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
      updateAccessToken(accountId, mp, data.access_token, data.expires_in, data.scope);
      log.info('access token refreshed (per-account)', { market, accountId, expiresIn: data.expires_in });
      return data.access_token;
    }
    // Else fall through to legacy lookup (no credentials configured for this account yet).
  }

  // ── Legacy / shared path ───────────────────────────────────────────────────
  const cached = cache.get(market);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const { clientId, clientSecret, refreshToken } = readCredentials(market);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      `eBay ${market.toUpperCase()} credentials missing — set ebay_${market}_client_id / ebay_${market}_client_secret / ebay_${market}_refresh_token`,
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(authUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay ${market.toUpperCase()} token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(market, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  log.info('access token refreshed', { market, expiresIn: data.expires_in });
  return data.access_token;
}

// ── REST helper with automatic single 401-retry ──────────────────────────────

export interface EbayCallResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function ebayFetch<T>(
  market: EbayMarket,
  method: string,
  endpoint: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  accountId?: number,
): Promise<EbayCallResult<T>> {
  const doCall = async (): Promise<{ res: Response; text: string }> => {
    const token = await getAccessToken(market, accountId);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': contentLanguage(market),
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId(market),
      ...(extraHeaders ?? {}),
    };
    const res = await fetch(`${ebayApiBase()}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    return { res, text };
  };

  let { res, text } = await doCall();

  // One 401-retry — clear the right cache (per-account row or legacy in-process map)
  if (res.status === 401) {
    if (accountId != null) {
      invalidateAccountAccessToken(accountId, marketKey(market));
    } else {
      invalidateToken(market);
    }
    ({ res, text } = await doCall());
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `${res.status}: ${text.slice(0, 300)}`,
    };
  }

  if (res.status === 204 || text.length === 0) {
    return { ok: true, status: res.status, data: {} as T };
  }

  try {
    return { ok: true, status: res.status, data: JSON.parse(text) as T };
  } catch {
    // Non-JSON success body — return raw
    return { ok: true, status: res.status, data: text as unknown as T };
  }
}
