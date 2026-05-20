// ──────────────────────────────────────────────────────────────────────────────
// Thin fetch wrapper — patterned after User-Dashboard/src/app/api/client.ts.
// Vite's dev proxy forwards /api and /stream to the orchestrator on :4700.
//
// Every request carries `Authorization: Bearer <token>` where <token> is
// fetched lazily from the orchestrator's loopback-only `/auth/token` endpoint.
// On 401 we re-fetch the token once and retry the original request — covers
// the case where the orchestrator was restarted with a new token while the
// dashboard kept running.
// ──────────────────────────────────────────────────────────────────────────────

import { apiUrl } from './base.js';

type FetchInit = Omit<RequestInit, 'body'> & { body?: unknown };

let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchOrchToken(): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/auth/token'), { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { token?: string };
    return json.token ?? null;
  } catch {
    return null;
  }
}

async function getOrchToken(force = false): Promise<string | null> {
  if (!force && cachedToken) return cachedToken;
  if (inflight) return inflight;
  inflight = (async () => {
    const tok = await fetchOrchToken();
    cachedToken = tok;
    return tok;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function doRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  rest: Omit<FetchInit, 'body' | 'headers'>,
): Promise<Response> {
  const token = await getOrchToken();
  const hdr: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  };
  if (token) hdr['Authorization'] = `Bearer ${token}`;
  return fetch(url, {
    ...rest,
    method,
    headers: hdr,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(method: string, path: string, init: FetchInit = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const url = apiUrl(`/api${path}`);

  let res = await doRequest(method, url, (headers as Record<string, string>) ?? {}, body, rest);
  if (res.status === 401) {
    // Token invalidated (orchestrator restart, file rotated, etc.) — re-fetch
    // once and retry. If the second attempt still 401s, fall through to the
    // normal error path so the caller sees `unauthorized`.
    cachedToken = null;
    await getOrchToken(true);
    res = await doRequest(method, url, (headers as Record<string, string>) ?? {}, body, rest);
  }

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
  put: <T>(p: string, body?: unknown) => request<T>('PUT', p, { body }),
  del: <T>(p: string) => request<T>('DELETE', p),
};
