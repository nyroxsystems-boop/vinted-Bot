// ──────────────────────────────────────────────────────────────────────────────
// WooCommerce REST API auth via Basic Auth (Consumer Key + Consumer Secret).
// Settings: woocommerce_url, woocommerce_consumer_key, woocommerce_consumer_secret.
// ──────────────────────────────────────────────────────────────────────────────

import { getSetting, createLogger } from '@vinted-system/shared';

const log = createLogger('woocommerce-auth');

export interface WooCreds {
  url: string;
  key: string;
  secret: string;
}

export function readWooCreds(): WooCreds | null {
  const url = getSetting('woocommerce_url') ?? process.env.WOOCOMMERCE_URL;
  const key = getSetting('woocommerce_consumer_key') ?? process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = getSetting('woocommerce_consumer_secret') ?? process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!url || !key || !secret) return null;
  return { url: url.replace(/\/$/, ''), key, secret };
}

export function hasCredentials(): boolean {
  return readWooCreds() !== null;
}

export function wooApiBase(creds: WooCreds, version = 'v3'): string {
  return `${creds.url}/wp-json/wc/${version}`;
}

function basicAuthHeader(creds: WooCreds): string {
  return 'Basic ' + Buffer.from(`${creds.key}:${creds.secret}`).toString('base64');
}

export async function wooFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const creds = readWooCreds();
  if (!creds) return { ok: false, status: 0, error: 'woocommerce credentials not configured' };
  try {
    const url = `${wooApiBase(creds)}${path}`;
    const r = await fetch(url, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(creds),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: `${r.status}: ${text.slice(0, 200)}` };
    }
    const data = (await r.json()) as T;
    return { ok: true, status: r.status, data };
  } catch (err) {
    log.warn('wooFetch failed', { path, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
