// ──────────────────────────────────────────────────────────────────────────────
// Shopify routes — Custom-App credentials, status, test.
//
// Shopify Admin REST API uses a per-shop Custom App access token (not OAuth).
// Two settings:
//   - shopify_shop          (e.g. "myshop.myshopify.com")
//   - shopify_access_token  (Custom App admin token, "shpat_...")
//
// All values live in `settings` so they can be updated without restarting the
// orchestrator. Falls back to env vars if settings are empty.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getSetting, setSetting } from '@vinted-system/shared';

const log = createLogger('routes:shopify');
export const shopifyRouter = Router();

const SHOPIFY_BOT_URL = process.env.SHOPIFY_BOT_URL ?? 'http://127.0.0.1:4717';

function readCreds(): { shop: string; access_token_set: boolean; enabled: boolean } {
  const shop = getSetting('shopify_shop') ?? process.env.SHOPIFY_SHOP ?? '';
  const tok = getSetting('shopify_access_token') ?? process.env.SHOPIFY_ACCESS_TOKEN ?? '';
  const enabled = getSetting('shopify_enabled') === 'true';
  return { shop, access_token_set: !!tok, enabled };
}

shopifyRouter.get('/auth', (_req, res) => {
  try {
    res.json({ ok: true, ...readCreds() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

shopifyRouter.put('/auth', (req, res) => {
  try {
    const { shop, access_token, enabled } = req.body as {
      shop?: string; access_token?: string; enabled?: boolean;
    };
    if (shop !== undefined) {
      // Normalize: strip protocol + trailing slash, accept bare subdomain too.
      const clean = shop.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const full = clean.includes('.') ? clean : `${clean}.myshopify.com`;
      setSetting('shopify_shop', full);
    }
    if (access_token !== undefined) {
      const t = access_token.trim();
      // Empty token = "keep existing"; only overwrite if non-empty.
      if (t.length > 0) setSetting('shopify_access_token', t);
    }
    if (enabled !== undefined) setSetting('shopify_enabled', enabled ? 'true' : 'false');
    log.info('Shopify credentials updated', { enabled });
    res.json({ ok: true, ...readCreds() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Test connectivity — hits the bot's /api/auth/status which calls /shop.json.
shopifyRouter.post('/auth/test', async (_req, res) => {
  try {
    const r = await fetch(`${SHOPIFY_BOT_URL}/api/auth/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean; configured?: boolean; status?: number; error?: string;
    };
    if (data.ok) {
      res.json({ ok: true, message: 'Shop erreichbar — Token gültig.' });
    } else if (!data.configured) {
      res.status(400).json({ ok: false, error: 'Shop oder Access-Token fehlt.' });
    } else {
      res.status(400).json({ ok: false, error: data.error ?? `HTTP ${data.status ?? r.status}` });
    }
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e instanceof Error
        ? `Bot nicht erreichbar (${SHOPIFY_BOT_URL}): ${e.message}`
        : String(e),
    });
  }
});
