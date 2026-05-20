// ──────────────────────────────────────────────────────────────────────────────
// Shopify Admin API Client
//
// Uses the official Shopify Admin REST API to create/manage product listings.
// Docs: https://shopify.dev/docs/api/admin-rest/2024-01/resources/product
//
// Required env vars:
//   SHOPIFY_STORE_URL    — e.g. "mystore.myshopify.com"
//   SHOPIFY_ACCESS_TOKEN — Admin API access token
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, type ListingDraft, type PublishResult, type DeactivateResult } from '@vinted-system/shared';

const log = createLogger('shopify-api');

const STORE_URL = process.env.SHOPIFY_STORE_URL ?? '';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN ?? '';
const API_VERSION = '2024-01';

function shopifyUrl(path: string) {
  return `https://${STORE_URL}/admin/api/${API_VERSION}${path}`;
}

async function shopifyFetch(path: string, opts: RequestInit = {}) {
  const url = shopifyUrl(path);
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ACCESS_TOKEN,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

// ── Map ListingDraft → Shopify Product ───────────────────────────────────────

function draftToShopifyProduct(draft: ListingDraft) {
  // Map condition to Shopify tags
  const tags = [
    draft.brand,
    draft.condition,
    draft.category,
    ...(draft.colors ?? []),
    draft.material,
    draft.size,
  ].filter(Boolean).join(', ');

  const images = (draft.photos ?? []).map((url, i) => ({
    src: url,
    position: i + 1,
  }));

  return {
    product: {
      title: draft.title,
      body_html: (draft.description ?? '').replace(/\n/g, '<br>'),
      vendor: draft.brand || 'Unknown',
      product_type: draft.category || 'Clothing',
      tags,
      status: 'draft', // Start as draft, user can publish manually
      variants: [
        {
          price: String(draft.priceEur ?? 0),
          sku: `BR-${draft.folderNum}`,
          inventory_quantity: 1,
          inventory_management: 'shopify',
          requires_shipping: true,
          weight: 0.5,
          weight_unit: 'kg',
        },
      ],
      images,
      options: draft.size ? [
        { name: 'Size', values: [draft.size] },
      ] : undefined,
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function shopifyCreateProduct(draft: ListingDraft): Promise<PublishResult> {
  if (!STORE_URL || !ACCESS_TOKEN) {
    return { ok: false, error: 'SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN not configured' };
  }

  try {
    const payload = draftToShopifyProduct(draft);
    log.info('Creating Shopify product', { title: draft.title, folderNum: draft.folderNum });

    const data = await shopifyFetch('/products.json', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const product = data.product;
    const productUrl = `https://${STORE_URL}/products/${product.handle}`;

    log.info('Shopify product created', { id: product.id, handle: product.handle });

    return {
      ok: true,
      externalId: String(product.id),
      externalUrl: productUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Shopify create failed', { error: msg });
    return { ok: false, error: msg };
  }
}

export async function shopifyDeactivateProduct(productId: string): Promise<DeactivateResult> {
  try {
    // Set product to draft (hidden from store)
    await shopifyFetch(`/products/${productId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ product: { id: Number(productId), status: 'draft' } }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function shopifyUpdatePrice(productId: string, newPriceEur: number): Promise<{ ok: boolean; error?: string }> {
  try {
    // Get variants first
    const data = await shopifyFetch(`/products/${productId}.json`);
    const variantId = data.product?.variants?.[0]?.id;
    if (!variantId) return { ok: false, error: 'No variant found' };

    await shopifyFetch(`/variants/${variantId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ variant: { id: variantId, price: String(newPriceEur) } }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function shopifyDeleteProduct(productId: string): Promise<DeactivateResult> {
  try {
    await shopifyFetch(`/products/${productId}.json`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
