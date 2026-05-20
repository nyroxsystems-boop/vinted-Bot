// Shopify product publish via Admin REST API.
import { createLogger } from '@vinted-system/shared';
import type { ListingDraft, PublishResult } from '@vinted-system/shared';
import { shopifyFetch } from '../auth/token.js';

const log = createLogger('shopify-create');

interface ProductResp {
  product: {
    id: number;
    handle: string;
    variants: Array<{ id: number; price: string }>;
  };
}

export async function createShopifyListing(draft: ListingDraft): Promise<PublishResult> {
  const body = {
    product: {
      title: draft.title,
      body_html: draft.description ?? '',
      vendor: draft.brand ?? 'Generic',
      product_type: draft.category ?? 'Apparel',
      status: 'active',
      tags: '', // tags array not on ListingDraft; future: variants
      variants: [{
        price: String(draft.priceEur?.toFixed(2) ?? '0'),
        sku: `auto-${Date.now()}`,
        inventory_management: 'shopify',
        inventory_quantity: 1,
        option1: draft.size ?? 'Default',
      }],
      images: (draft.photos ?? []).slice(0, 10).map((p) => ({ src: p })),
    },
  };

  const r = await shopifyFetch<ProductResp>('/products.json', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.data) {
    return { ok: false, error: r.error ?? 'no data' };
  }
  log.info('Shopify product created', { id: r.data.product.id });
  return {
    ok: true,
    externalId: `${r.data.product.id}:${r.data.product.variants[0]?.id ?? ''}`,
    externalUrl: `https://${(process.env.SHOPIFY_SHOP ?? 'myshop.myshopify.com').replace(/^https?:\/\//, '')}/products/${r.data.product.handle}`,
  };
}
