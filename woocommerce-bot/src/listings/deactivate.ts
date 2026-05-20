import { createLogger } from '@vinted-system/shared';
import { wooFetch } from '../auth/credentials.js';

const log = createLogger('woo-deactivate');

export async function deactivateListing(externalId: string): Promise<{ ok: boolean; error?: string }> {
  if (!externalId) return { ok: false, error: 'externalId required' };
  const r = await wooFetch(`/products/${externalId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'draft' }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  log.info('Woo product unpublished (draft)', { id: externalId });
  return { ok: true };
}
