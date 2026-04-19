// ──────────────────────────────────────────────────────────────────────────────
// Thin fetch wrapper — patterned after User-Dashboard/src/app/api/client.ts.
// Vite's dev proxy forwards /api and /stream to the orchestrator on :4700.
// ──────────────────────────────────────────────────────────────────────────────

type FetchInit = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(method: string, path: string, init: FetchInit = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });
  if (!res.ok) {
    let errorBody: { error?: string } = {};
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      /* non-JSON */
    }
    throw new Error(errorBody.error ?? `${method} ${path} → ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body?: unknown) => request<T>('POST', p, { body }),
  patch: <T>(p: string, body?: unknown) => request<T>('PATCH', p, { body }),
  del: <T>(p: string) => request<T>('DELETE', p),
};
