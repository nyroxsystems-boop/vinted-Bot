// ──────────────────────────────────────────────────────────────────────────────
// Shopify Admin REST API auth — uses a Custom App access token (not OAuth).
// Settings: `shopify_shop` (myshop.myshopify.com) + `shopify_access_token`.
// ──────────────────────────────────────────────────────────────────────────────

import { getSetting, createLogger } from '@vinted-system/shared';

const log = createLogger('shopify-auth');

export interface ShopifyCreds {
  shop: string;
  token: string;
}

export function readShopifyCreds(): ShopifyCreds | null {
  const shop = getSetting('shopify_shop') ?? process.env.SHOPIFY_SHOP;
  const token = getSetting('shopify_access_token') ?? process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !token) return null;
  return { shop, token };
}

export function hasCredentials(): boolean {
  return readShopifyCreds() !== null;
}

export function shopifyApiBase(creds: ShopifyCreds, apiVersion = '2024-10'): string {
  // shop is the myshopify.com subdomain, e.g. "myshop.myshopify.com".
  const host = creds.shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/admin/api/${apiVersion}`;
}

export async function shopifyFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const creds = readShopifyCreds();
  if (!creds) return { ok: false, status: 0, error: 'shopify credentials not configured' };
  try {
    const url = `${shopifyApiBase(creds)}${path}`;
    const r = await fetch(url, {
      ...init,
      headers: {
        'X-Shopify-Access-Token': creds.token,
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
    log.warn('shopifyFetch failed', { path, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
