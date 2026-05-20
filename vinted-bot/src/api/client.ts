// ──────────────────────────────────────────────────────────────────────────────
// Vinted-API HTTP Client.
//
// Dünne fetch-Wrapper mit:
//   • Auto-Auth-Headers aus VintedSession
//   • Retry-with-Backoff bei 5xx und Netzwerkfehlern
//   • Bei 401: Hint dass Re-Login nötig ist (caller entscheidet)
//   • Bei 403/429: nicht retryen, blockiert den Caller
//   • Diagnose-Logs bei unerwarteten Statuscodes
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, retry, markBlocked } from '@vinted-system/shared';
import { authHeaders, type VintedSession } from './session.js';

const log = createLogger('vinted-api-client');

const BLOCK_PATTERNS = [
  'Sitzung wurde blockiert',
  'session has been blocked',
  'ungewöhnliche Aktivitäten',
  'unusual activity',
  'temporär gesperrt',
];

function detectBlockPage(body: string): string | null {
  for (const p of BLOCK_PATTERNS) {
    if (body.includes(p)) return p;
  }
  return null;
}

export class VintedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly url: string,
    public readonly method: string,
  ) {
    super(`Vinted-API ${method} ${url} → ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'VintedApiError';
  }
}

export class VintedAuthExpiredError extends VintedApiError {
  constructor(url: string, method: string, body: string) {
    super(401, body, url, method);
    this.name = 'VintedAuthExpiredError';
  }
}

export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;                       // wird zu JSON wenn kein FormData
  rawBody?: BodyInit;                   // für FormData/Multipart
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryAttempts?: number;
}

export class VintedApi {
  constructor(private session: VintedSession) {}

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.session.baseUrl}${path}`;
  }

  async call<T = unknown>(path: string, opts: ApiCallOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = this.url(path);
    const isJson = !opts.rawBody && opts.body !== undefined;
    const headers = authHeaders(this.session, {
      ...(isJson ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    });

    const body = opts.rawBody ?? (isJson ? JSON.stringify(opts.body) : undefined);

    return retry(
      async () => {
        const r = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
        const text = await r.text();

        if (r.status === 401) {
          log.warn('401 Unauthorized — Vinted session expired', { url, method });
          throw new VintedAuthExpiredError(url, method, text);
        }
        if (r.status === 403 || r.status === 429) {
          log.error('Vinted blocked the API call', { url, method, status: r.status, snippet: text.slice(0, 200) });
          markBlocked('vinted', `HTTP ${r.status} on ${url}`, 45);
          throw new VintedApiError(r.status, text, url, method);
        }
        // Vinted serviert manchmal HTML 200 mit Block-Page statt JSON.
        const blockHit = detectBlockPage(text);
        if (blockHit) {
          log.error('Vinted block-page detected in API response', { url, method, hit: blockHit });
          markBlocked('vinted', `block-page in body: "${blockHit}"`, 45);
          throw new VintedApiError(r.status, `BLOCKED: ${blockHit}`, url, method);
        }
        if (!r.ok) {
          log.warn('non-2xx response', { url, method, status: r.status, snippet: text.slice(0, 200) });
          throw new VintedApiError(r.status, text, url, method);
        }
        if (!text) return undefined as T;
        try { return JSON.parse(text) as T; }
        catch {
          throw new VintedApiError(r.status, `non-JSON response: ${text.slice(0, 100)}`, url, method);
        }
      },
      {
        attempts: opts.retryAttempts ?? 3,
        baseDelayMs: 800,
        label: `vinted-api ${method} ${path}`,
        // 401/403/429 nicht retryen — bringt nichts
        abortIf: (e) => {
          if (e instanceof VintedApiError) return [401, 403, 429].includes(e.status);
          return false;
        },
      },
    );
  }

  get<T = unknown>(path: string, opts: Omit<ApiCallOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.call<T>(path, { ...opts, method: 'GET' });
  }
  post<T = unknown>(path: string, body?: unknown, opts: Omit<ApiCallOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.call<T>(path, { ...opts, method: 'POST', body });
  }
  put<T = unknown>(path: string, body?: unknown, opts: Omit<ApiCallOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.call<T>(path, { ...opts, method: 'PUT', body });
  }
  delete<T = unknown>(path: string, opts: Omit<ApiCallOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.call<T>(path, { ...opts, method: 'DELETE' });
  }
}
