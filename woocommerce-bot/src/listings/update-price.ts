import { createLogger } from '@vinted-system/shared';
import { wooFetch } from '../auth/credentials.js';

const log = createLogger('woo-update-price');

export async function updateListingPrice(externalId: string, newPrice: number): Promise<{ ok: boolean; error?: string }> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  const r = await wooFetch(`/products/${externalId}`, {
    method: 'PUT',
    body: JSON.stringify({ regular_price: newPrice.toFixed(2) }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  log.info('Woo product price updated', { id: externalId, newPrice });
  return { ok: true };
}
