const BASE = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(`vinted-bot ${path} failed: ${body.error ?? res.statusText}`);
  }
  return body;
}

export const vintedClient = {
  status: () => call<{ bot: string; queue: unknown }>('/status'),
  pollInbox: () =>
    call<{ ok: boolean; result: { newMessages: number; newOffers: number } }>('/poll/inbox', {
      method: 'POST',
    }),
  pollSales: () =>
    call<{ ok: boolean; result: { updated: number } }>('/poll/sales', { method: 'POST' }),
  acceptOffer: (id: number, decidedBy: 'auto' | 'manual') =>
    call<{ ok: boolean; saleId?: number; error?: string }>(`/offers/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy }),
    }),
  declineOffer: (id: number, decidedBy: 'auto' | 'manual') =>
    call<{ ok: boolean; error?: string }>(`/offers/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy }),
    }),
};
