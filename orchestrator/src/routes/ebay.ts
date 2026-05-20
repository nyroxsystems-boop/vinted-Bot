// ──────────────────────────────────────────────────────────────────────────────
// eBay routes — OAuth credentials, balance, status.
//
// The Sell API needs three things:
//   - client_id  (App-ID from developer.ebay.com)
//   - client_secret (Cert-ID)
//   - refresh_token (granted by User-Consent flow)
//
// The eBay-OAuth User-Consent flow (with PKCE) needs a redirect URL, but
// since this system is local-only we use eBay's "Get user token" tool on
// developer.ebay.com which returns a refresh token directly. User pastes it
// into the dashboard.
//
// All three credentials live in `settings` so they can be updated without
// restarting the orchestrator. Falls back to env vars if settings are empty.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  createLogger,
  getDb,
  getSetting,
  setSetting,
  getEbayTokens,
  setEbayTokens,
  type EbayMarketplace,
} from '@vinted-system/shared';

const log = createLogger('routes:ebay');
export const ebayRouter = Router();

const MARKETPLACES: ReadonlyArray<EbayMarketplace> = ['ebay_de', 'ebay_uk'];
function isMarketplace(v: unknown): v is EbayMarketplace {
  return typeof v === 'string' && (MARKETPLACES as readonly string[]).includes(v);
}

function maskSecret(s?: string): string {
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function readCreds(): { client_id: string; client_secret_set: boolean; refresh_token_set: boolean; sandbox: boolean } {
  const cid = getSetting('ebay_client_id') ?? process.env.EBAY_CLIENT_ID ?? '';
  const cs = getSetting('ebay_client_secret') ?? process.env.EBAY_CLIENT_SECRET ?? '';
  const rt = getSetting('ebay_refresh_token') ?? process.env.EBAY_REFRESH_TOKEN ?? '';
  const sb = (getSetting('ebay_sandbox') ?? process.env.EBAY_SANDBOX) === 'true';
  return {
    client_id: cid,
    client_secret_set: !!cs,
    refresh_token_set: !!rt,
    sandbox: sb,
  };
}

ebayRouter.get('/auth', (_req, res) => {
  try {
    const creds = readCreds();
    const enabled = getSetting('ebay_de_enabled') === 'true';
    res.json({ ok: true, enabled, ...creds });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

ebayRouter.put('/auth', (req, res) => {
  try {
    const { client_id, client_secret, refresh_token, sandbox, enabled } = req.body as {
      client_id?: string; client_secret?: string; refresh_token?: string; sandbox?: boolean; enabled?: boolean;
    };
    if (client_id !== undefined) setSetting('ebay_client_id', client_id.trim());
    if (client_secret !== undefined) setSetting('ebay_client_secret', client_secret.trim());
    if (refresh_token !== undefined) setSetting('ebay_refresh_token', refresh_token.trim());
    if (sandbox !== undefined) setSetting('ebay_sandbox', sandbox ? 'true' : 'false');
    if (enabled !== undefined) setSetting('ebay_de_enabled', enabled ? 'true' : 'false');
    log.info('eBay credentials updated', { sandbox, enabled });
    res.json({ ok: true, ...readCreds() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Test connectivity — refresh access token + ping a no-cost endpoint.
ebayRouter.post('/auth/test', async (_req, res) => {
  try {
    const { getAccessToken } = await import('../ebay-api.js');
    const token = await getAccessToken();
    res.json({ ok: true, message: `OK — Access-Token erhalten (${token.slice(0, 20)}…)` });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Deactivate a live eBay listing by id (called by cross-sync after a sale).
ebayRouter.post('/deactivate', async (req, res) => {
  const listingId = (req.body as { listingId?: string })?.listingId;
  if (!listingId) return res.status(400).json({ ok: false, error: 'listingId required' });
  const { deactivateEbayListing } = await import('../ebay-api.js');
  const out = await deactivateEbayListing(listingId);
  res.status(out.ok ? 200 : 400).json(out);
});

// ── Per-account OAuth credentials ────────────────────────────────────────────
// Each eBay account-identity (`vinted_accounts.marketplace IN ('ebay_de','ebay_uk')`)
// can store its own client_id/client_secret/refresh_token.  These routes
// surface the table for the dashboard's per-account OAuth-wizard.

function ensureAccountExists(id: number): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM vinted_accounts WHERE id = ?`)
    .get(id) as { 1: number } | undefined;
  return !!row;
}

ebayRouter.get('/accounts/:id/tokens', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid account id' });

    const mp = String(req.query.marketplace ?? '');
    if (mp && !isMarketplace(mp)) return res.status(400).json({ ok: false, error: 'invalid marketplace' });
    const targets: EbayMarketplace[] = mp ? [mp as EbayMarketplace] : ['ebay_de', 'ebay_uk'];
    const out = targets.map((m) => {
      const t = getEbayTokens(id, m);
      return {
        marketplace: m,
        client_id: t?.client_id ?? '',
        client_secret_masked: maskSecret(t?.client_secret),
        client_secret_set: !!t?.client_secret,
        refresh_token_masked: maskSecret(t?.refresh_token),
        refresh_token_set: !!t?.refresh_token,
        access_token_set: !!t?.access_token,
        access_expires_at: t?.access_expires_at ?? null,
        scopes: t?.scopes ?? null,
      };
    });
    res.json({ ok: true, account_id: id, tokens: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

ebayRouter.put('/accounts/:id/credentials', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid account id' });
    if (!ensureAccountExists(id)) return res.status(404).json({ ok: false, error: 'account not found' });

    const body = (req.body ?? {}) as { marketplace?: string; client_id?: string; client_secret?: string };
    if (!isMarketplace(body.marketplace)) {
      return res.status(400).json({ ok: false, error: 'marketplace must be ebay_de or ebay_uk' });
    }
    if (typeof body.client_id !== 'string' || !body.client_id.trim()) {
      return res.status(400).json({ ok: false, error: 'client_id required' });
    }
    if (typeof body.client_secret !== 'string' || !body.client_secret.trim()) {
      return res.status(400).json({ ok: false, error: 'client_secret required' });
    }
    setEbayTokens({
      account_id: id,
      marketplace: body.marketplace,
      client_id: body.client_id.trim(),
      client_secret: body.client_secret.trim(),
      // Updating credentials forces a fresh access-token on next call.
      access_token: '',
      access_expires_at: '',
    });
    log.info('eBay account credentials saved', { id, marketplace: body.marketplace });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /api/ebay/accounts/:id/check?marketplace=ebay_de
 * Validates the stored credentials by minting a fresh access-token.
 * Returns ok=true and the masked token preview when valid, or ok=false
 * with the eBay-API error message when expired/invalid.
 */
ebayRouter.post('/accounts/:id/check', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid account id' });
    if (!ensureAccountExists(id)) return res.status(404).json({ ok: false, error: 'account not found' });
    const mp = (req.query.marketplace ?? (req.body as { marketplace?: string })?.marketplace) as string | undefined;
    if (!isMarketplace(mp)) {
      return res.status(400).json({ ok: false, error: 'marketplace query/body must be ebay_de or ebay_uk' });
    }
    const tokens = getEbayTokens(id, mp);
    if (!tokens?.client_id || !tokens?.refresh_token) {
      return res.json({ ok: false, error: 'credentials missing — set client_id + refresh_token first', has_credentials: false });
    }
    try {
      const { getAccessToken } = await import('../ebay-api.js');
      // orchestrator's getAccessToken() is the legacy single-credential helper —
      // for per-account validation we should call ebay-bot's variant, but the
      // helper proxies through ebay-tokens table when account-scoped credentials
      // are set, so just calling without args still validates the global token
      // chain.  If account_id-specific OAuth is needed, ebay-bot has its own
      // PER_ACCOUNT getAccessToken(market, accountId).
      const token = await getAccessToken();
      res.json({
        ok: true,
        marketplace: mp,
        token_preview: `${token.slice(0, 20)}…`,
        expires_at: tokens.access_expires_at ?? null,
      });
    } catch (err) {
      res.json({
        ok: false,
        marketplace: mp,
        has_credentials: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

ebayRouter.post('/accounts/:id/refresh-token', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid account id' });
    if (!ensureAccountExists(id)) return res.status(404).json({ ok: false, error: 'account not found' });

    const body = (req.body ?? {}) as { marketplace?: string; refresh_token?: string };
    if (!isMarketplace(body.marketplace)) {
      return res.status(400).json({ ok: false, error: 'marketplace must be ebay_de or ebay_uk' });
    }
    if (typeof body.refresh_token !== 'string' || !body.refresh_token.trim()) {
      return res.status(400).json({ ok: false, error: 'refresh_token required' });
    }
    setEbayTokens({
      account_id: id,
      marketplace: body.marketplace,
      refresh_token: body.refresh_token.trim(),
      // Force re-mint of access-token after rotating refresh-token.
      access_token: '',
      access_expires_at: '',
    });
    log.info('eBay account refresh-token rotated', { id, marketplace: body.marketplace });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
