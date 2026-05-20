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

function withAccount(path: string, accountId?: number): string {
  if (accountId === undefined) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}account=${accountId}`;
}

interface CreateListingInput {
  title: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  color: string;
  material?: string;
  price: number;
  photoPaths: string[];
}

interface CreateListingResult {
  ok: boolean;
  vintedUrl?: string;
  vintedItemId?: string;
  error?: string;
}

export const vintedClient = {
  status: (accountId?: number) =>
    call<{ bot: string; account_id: number; queue: unknown }>(withAccount('/status', accountId)),

  pollInbox: (accountId?: number) =>
    call<{ ok: boolean; accountId: number; result: { newMessages: number; newOffers: number } }>(
      withAccount('/poll/inbox', accountId),
      { method: 'POST' },
    ),
  pollSales: (accountId?: number) =>
    call<{ ok: boolean; accountId: number; result: { updated: number } }>(
      withAccount('/poll/sales', accountId),
      { method: 'POST' },
    ),

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

  createListing: (input: CreateListingInput, accountId?: number) =>
    call<CreateListingResult>(withAccount('/listings/create', accountId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  sendMessage: (chatId: number, message: string) =>
    call<{ ok: boolean; error?: string }>(`/chats/${chatId}/send`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  downloadLabel: (saleId: number) =>
    call<{ ok: boolean; path?: string; error?: string }>(
      `/sales/${saleId}/label`,
      { method: 'POST' },
    ),
  leaveFeedback: (saleId: number) =>
    call<{ ok: boolean; skipped?: boolean; error?: string }>(
      `/sales/${saleId}/feedback`,
      { method: 'POST' },
    ),
  updateListingPrice: (vintedItemId: string, price: number) =>
    call<{ ok: boolean; error?: string }>(
      `/listings/${vintedItemId}/price`,
      { method: 'POST', body: JSON.stringify({ price }) },
    ),

  // Multi-account
  startLogin: (accountId: number) =>
    call<{ ok: boolean }>(withAccount('/login/start', accountId), { method: 'POST' }),
  loginStatus: (accountId: number) =>
    call<{ session: unknown; login: unknown }>(withAccount('/login/status', accountId)),
  selectAccount: (accountId: number) =>
    call<{ ok: boolean }>('/accounts/select', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
};
