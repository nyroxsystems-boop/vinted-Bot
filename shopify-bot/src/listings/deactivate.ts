import { createLogger } from '@vinted-system/shared';
import { shopifyFetch } from '../auth/token.js';

const log = createLogger('shopify-deactivate');

export async function deactivateListing(externalId: string): Promise<{ ok: boolean; error?: string }> {
  // externalId format: "productId:variantId" — only need productId for unpublish
  const productId = externalId.includes(':') ? externalId.split(':')[0] : externalId;
  if (!productId) return { ok: false, error: 'no productId in externalId' };

  const r = await shopifyFetch(`/products/${productId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ product: { id: Number(productId), status: 'archived' } }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  log.info('Shopify product archived', { productId });
  return { ok: true };
}
