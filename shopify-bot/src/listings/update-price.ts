import { createLogger } from '@vinted-system/shared';
import { shopifyFetch } from '../auth/token.js';

const log = createLogger('shopify-update-price');

export async function updateListingPrice(externalId: string, newPrice: number): Promise<{ ok: boolean; error?: string }> {
  // externalId format: "productId:variantId" (set by createShopifyListing)
  const variantId = externalId.includes(':') ? externalId.split(':')[1] : externalId;
  if (!variantId) return { ok: false, error: 'no variantId in externalId' };

  const r = await shopifyFetch(`/variants/${variantId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ variant: { id: Number(variantId), price: newPrice.toFixed(2) } }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  log.info('Shopify variant price updated', { variantId, newPrice });
  return { ok: true };
}
