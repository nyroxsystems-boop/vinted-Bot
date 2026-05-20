// ──────────────────────────────────────────────────────────────────────────────
// Per-account eBay OAuth-token helpers.
//
// Each eBay account-identity (`vinted_accounts.marketplace IN ('ebay_de','ebay_uk')`)
// has its own client_id/client_secret/refresh_token + cached access_token in
// the `ebay_account_tokens` table. The bot looks up by (account_id, marketplace)
// so the 10 eBay-accounts each have their own credentials.
//
// Fallback chain (handled in ebay-bot/src/auth/token.ts):
//   1) ebay_account_tokens(account_id, marketplace)        — preferred
//   2) settings `ebay_<market>_<kind>`                     — legacy per-market
//   3) settings `ebay_<kind>`                              — legacy shared
//   4) env `EBAY_<MARKET>_<KIND>` / `EBAY_<KIND>`          — env fallback
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export type EbayMarketplace = 'ebay_de' | 'ebay_uk';

export interface EbayAccountToken {
  account_id: number;
  marketplace: EbayMarketplace;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  access_expires_at?: string;
  scopes?: string;
}

interface Row {
  account_id: number;
  marketplace: string;
  client_id: string | null;
  client_secret: string | null;
  refresh_token: string | null;
  access_token: string | null;
  access_expires_at: string | null;
  scopes: string | null;
  updated_at: string;
}

function fromRow(row: Row | undefined): EbayAccountToken | null {
  if (!row) return null;
  return {
    account_id: row.account_id,
    marketplace: row.marketplace as EbayMarketplace,
    client_id:     row.client_id     ?? undefined,
    client_secret: row.client_secret ?? undefined,
    refresh_token: row.refresh_token ?? undefined,
    access_token:  row.access_token  ?? undefined,
    access_expires_at: row.access_expires_at ?? undefined,
    scopes: row.scopes ?? undefined,
  };
}

/** Look up the per-account token row. Returns `null` when no row exists. */
export function getEbayTokens(accountId: number, marketplace: string): EbayAccountToken | null {
  const row = getDb()
    .prepare(
      `SELECT account_id, marketplace, client_id, client_secret, refresh_token,
              access_token, access_expires_at, scopes, updated_at
         FROM ebay_account_tokens
        WHERE account_id = ? AND marketplace = ?`,
    )
    .get(accountId, marketplace) as Row | undefined;
  return fromRow(row);
}

/** UPSERT a token row. Only non-undefined fields overwrite existing values —
 *  partial updates (e.g. just `refresh_token`) preserve the rest. */
export function setEbayTokens(t: EbayAccountToken): void {
  const db = getDb();
  const existing = getEbayTokens(t.account_id, t.marketplace);

  const merged: Required<Omit<EbayAccountToken, 'account_id' | 'marketplace'>> = {
    client_id:     t.client_id     ?? existing?.client_id     ?? '',
    client_secret: t.client_secret ?? existing?.client_secret ?? '',
    refresh_token: t.refresh_token ?? existing?.refresh_token ?? '',
    access_token:  t.access_token  ?? existing?.access_token  ?? '',
    access_expires_at: t.access_expires_at ?? existing?.access_expires_at ?? '',
    scopes:        t.scopes        ?? existing?.scopes        ?? '',
  };

  db.prepare(
    `INSERT INTO ebay_account_tokens
       (account_id, marketplace, client_id, client_secret, refresh_token,
        access_token, access_expires_at, scopes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, marketplace) DO UPDATE SET
       client_id         = excluded.client_id,
       client_secret     = excluded.client_secret,
       refresh_token     = excluded.refresh_token,
       access_token      = excluded.access_token,
       access_expires_at = excluded.access_expires_at,
       scopes            = excluded.scopes,
       updated_at        = excluded.updated_at`,
  ).run(
    t.account_id,
    t.marketplace,
    merged.client_id || null,
    merged.client_secret || null,
    merged.refresh_token || null,
    merged.access_token || null,
    merged.access_expires_at || null,
    merged.scopes || null,
  );
}

/** Persist a freshly minted access-token + computed expires_at. */
export function updateAccessToken(
  accountId: number,
  marketplace: string,
  accessToken: string,
  expiresIn: number,
  scopes?: string,
): void {
  const expiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE ebay_account_tokens
        SET access_token = ?,
            access_expires_at = ?,
            scopes = COALESCE(?, scopes),
            updated_at = datetime('now')
      WHERE account_id = ? AND marketplace = ?`,
  ).run(accessToken, expiresAt, scopes ?? null, accountId, marketplace);
}

/** Clear cached access-token (keeps client_id/secret/refresh_token). Called
 *  by the bot on a 401 so the next request forces a fresh OAuth refresh. */
export function invalidateAccessToken(accountId: number, marketplace: string): void {
  getDb()
    .prepare(
      `UPDATE ebay_account_tokens
          SET access_token = NULL,
              access_expires_at = NULL,
              updated_at = datetime('now')
        WHERE account_id = ? AND marketplace = ?`,
    )
    .run(accountId, marketplace);
}
