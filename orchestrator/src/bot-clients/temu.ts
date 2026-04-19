const BASE = `http://localhost:${process.env.TEMU_BOT_PORT ?? '4702'}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(`temu-bot ${path} failed: ${body.error ?? res.statusText}`);
  }
  return body;
}

export const temuClient = {
  status: () => call<{ bot: string; queue: unknown }>('/status'),

  // Batch-cart mode: create a new batch collecting paid sales from the last
  // `windowHours` hours that aren't already in a non-failed batch.
  createBatch: (windowHours: number) =>
    call<{ ok: boolean; batchId: number; saleCount: number }>('/batches', {
      method: 'POST',
      body: JSON.stringify({ windowHours }),
    }),

  // Kick off the actual add-to-cart run. Returns per-item results.
  addBatchToCart: (batchId: number) =>
    call<{
      ok: boolean;
      batchId: number;
      added: number;
      failed: number;
      items: Array<{ saleId: number; temuUrl: string; added: boolean; error?: string }>;
      cartUrl: string;
    }>(`/batches/${batchId}/add`, { method: 'POST' }),

  pollOrders: () =>
    call<{ ok: boolean; result: { updated: number } }>('/poll/orders', { method: 'POST' }),
};
