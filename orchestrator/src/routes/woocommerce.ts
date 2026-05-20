// ──────────────────────────────────────────────────────────────────────────────
// WooCommerce routes — Consumer Key/Secret, status, test.
//
// WooCommerce REST API v3 uses Basic Auth over HTTPS with a Consumer Key +
// Consumer Secret pair generated in WP-Admin → WooCommerce → Settings → Advanced
// → REST API.
//
// Three settings:
//   - woocommerce_url              (e.g. "https://shop.example.com")
//   - woocommerce_consumer_key     ("ck_...")
//   - woocommerce_consumer_secret  ("cs_...")
//
// All values live in `settings` so they can be updated without restarting the
// orchestrator. Falls back to env vars if settings are empty.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getSetting, setSetting } from '@vinted-system/shared';

const log = createLogger('routes:woocommerce');
export const woocommerceRouter = Router();

const WOO_BOT_URL = process.env.WOOCOMMERCE_BOT_URL ?? 'http://127.0.0.1:4718';

function readCreds(): {
  url: string;
  consumer_key_set: boolean;
  consumer_secret_set: boolean;
  enabled: boolean;
} {
  const url = getSetting('woocommerce_url') ?? process.env.WOOCOMMERCE_URL ?? '';
  const key = getSetting('woocommerce_consumer_key') ?? process.env.WOOCOMMERCE_CONSUMER_KEY ?? '';
  const sec = getSetting('woocommerce_consumer_secret') ?? process.env.WOOCOMMERCE_CONSUMER_SECRET ?? '';
  const enabled = getSetting('woocommerce_enabled') === 'true';
  return { url, consumer_key_set: !!key, consumer_secret_set: !!sec, enabled };
}

woocommerceRouter.get('/auth', (_req, res) => {
  try {
    res.json({ ok: true, ...readCreds() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

woocommerceRouter.put('/auth', (req, res) => {
  try {
    const { url, consumer_key, consumer_secret, enabled } = req.body as {
      url?: string; consumer_key?: string; consumer_secret?: string; enabled?: boolean;
    };
    if (url !== undefined) {
      const clean = url.trim().replace(/\/$/, '');
      if (clean && !/^https?:\/\//i.test(clean)) {
        return res.status(400).json({ ok: false, error: 'URL muss mit http(s):// beginnen.' });
      }
      setSetting('woocommerce_url', clean);
    }
    if (consumer_key !== undefined) {
      const k = consumer_key.trim();
      if (k.length > 0) setSetting('woocommerce_consumer_key', k);
    }
    if (consumer_secret !== undefined) {
      const s = consumer_secret.trim();
      if (s.length > 0) setSetting('woocommerce_consumer_secret', s);
    }
    if (enabled !== undefined) setSetting('woocommerce_enabled', enabled ? 'true' : 'false');
    log.info('WooCommerce credentials updated', { enabled });
    res.json({ ok: true, ...readCreds() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

woocommerceRouter.post('/auth/test', async (_req, res) => {
  try {
    const r = await fetch(`${WOO_BOT_URL}/api/auth/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean; configured?: boolean; status?: number; error?: string;
    };
    if (data.ok) {
      res.json({ ok: true, message: 'Shop erreichbar — Schlüssel gültig.' });
    } else if (!data.configured) {
      res.status(400).json({ ok: false, error: 'URL oder Consumer-Schlüssel fehlt.' });
    } else {
      res.status(400).json({ ok: false, error: data.error ?? `HTTP ${data.status ?? r.status}` });
    }
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e instanceof Error
        ? `Bot nicht erreichbar (${WOO_BOT_URL}): ${e.message}`
        : String(e),
    });
  }
});
