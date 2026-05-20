// ──────────────────────────────────────────────────────────────────────────────
// WooCommerce REST API Client
//
// Uses the official WooCommerce REST API v3 to create/manage products.
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
//
// Required env vars:
//   WOOCOMMERCE_URL          — e.g. "https://mystore.com"
//   WOOCOMMERCE_CONSUMER_KEY — REST API consumer key
//   WOOCOMMERCE_CONSUMER_SECRET — REST API consumer secret
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, type ListingDraft, type PublishResult, type DeactivateResult } from '@vinted-system/shared';

const log = createLogger('woocommerce-api');

const WC_URL = process.env.WOOCOMMERCE_URL ?? '';
const WC_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY ?? '';
const WC_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET ?? '';

function wcUrl(path: string) {
  const base = `${WC_URL}/wp-json/wc/v3${path}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`;
}

async function wcFetch(path: string, opts: RequestInit = {}) {
  const url = wcUrl(path);
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WooCommerce ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

function draftToWcProduct(draft: ListingDraft) {
  const images = (draft.photos ?? []).map((src, i) => ({ src, position: i }));

  return {
    name: draft.title,
    type: 'simple',
    status: 'draft',
    description: (draft.description ?? '').replace(/\n/g, '<br>'),
    short_description: draft.title,
    regular_price: String(draft.priceEur ?? 0),
    sku: `BR-${draft.folderNum}`,
    manage_stock: true,
    stock_quantity: 1,
    categories: draft.category ? [{ name: draft.category }] : [],
    tags: [
      ...(draft.colors ?? []).map(c => ({ name: c })),
      draft.brand ? { name: draft.brand } : null,
      draft.condition ? { name: draft.condition } : null,
    ].filter(Boolean),
    images,
    attributes: [
      draft.size ? { name: 'Size', options: [draft.size], visible: true } : null,
      draft.brand ? { name: 'Brand', options: [draft.brand], visible: true } : null,
      draft.material ? { name: 'Material', options: [draft.material], visible: true } : null,
      draft.condition ? { name: 'Condition', options: [draft.condition], visible: true } : null,
    ].filter(Boolean),
  };
}

export async function wooCreateProduct(draft: ListingDraft): Promise<PublishResult> {
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return { ok: false, error: 'WOOCOMMERCE_URL, _CONSUMER_KEY, _CONSUMER_SECRET not configured' };
  }
  try {
    const payload = draftToWcProduct(draft);
    log.info('Creating WooCommerce product', { title: draft.title });

    const product = await wcFetch('/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    log.info('WooCommerce product created', { id: product.id });
    return {
      ok: true,
      externalId: String(product.id),
      externalUrl: product.permalink || `${WC_URL}/?p=${product.id}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('WooCommerce create failed', { error: msg });
    return { ok: false, error: msg };
  }
}

export async function wooDeactivateProduct(productId: string): Promise<DeactivateResult> {
  try {
    await wcFetch(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'draft' }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function wooUpdatePrice(productId: string, newPrice: number) {
  try {
    await wcFetch(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ regular_price: String(newPrice) }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function wooDeleteProduct(productId: string): Promise<DeactivateResult> {
  try {
    await wcFetch(`/products/${productId}?force=true`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
