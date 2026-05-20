import { createLogger } from '@vinted-system/shared';
import type { ListingDraft, PublishResult } from '@vinted-system/shared';
import { wooFetch, readWooCreds } from '../auth/credentials.js';

const log = createLogger('woo-create');

interface ProductResp {
  id: number;
  permalink: string;
  price: string;
}

export async function createWooListing(draft: ListingDraft): Promise<PublishResult> {
  const body = {
    name: draft.title,
    description: draft.description ?? '',
    short_description: (draft.description ?? '').slice(0, 250),
    regular_price: String(draft.priceEur?.toFixed(2) ?? '0'),
    status: 'publish',
    manage_stock: true,
    stock_quantity: 1,
    images: (draft.photos ?? []).slice(0, 10).map((p) => ({ src: p })),
    attributes: [
      ...(draft.size ? [{ name: 'Size', position: 0, visible: true, options: [draft.size] }] : []),
      ...(draft.brand ? [{ name: 'Brand', position: 1, visible: true, options: [draft.brand] }] : []),
    ],
  };

  const r = await wooFetch<ProductResp>('/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.data) return { ok: false, error: r.error ?? 'no data' };
  log.info('Woo product created', { id: r.data.id });
  return {
    ok: true,
    externalId: String(r.data.id),
    externalUrl: r.data.permalink ?? `${readWooCreds()?.url}/?p=${r.data.id}`,
  };
}
