import { Router } from 'express';
import type { SessionStatus } from '@vinted-system/shared';
import { BOT_ENDPOINTS } from '../marketplaces.js';

const VINTED = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;

interface BotAuthStatus {
  session: SessionStatus;
  login: {
    state: 'idle' | 'waiting' | 'success' | 'failed';
    message: string;
    started_at: string | null;
    finished_at: string | null;
  };
}

async function callBot<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${body.error ?? ''}`);
  }
  return body;
}

export const authRouter = Router();

// ── Unified marketplace-status endpoint ─────────────────────────────────────
//
// Single source of truth for "am I logged in to <mp> on account N?". Replaces
// per-mp polling from the dashboard (17 requests/3s) with one aggregated call
// that fans out server-side, caches for `CACHE_TTL_MS`, and returns a normalized
// status shape the UI can render directly.
//
// For browser-based bots → calls `<bot>/api/auth/status?account_id=N`.
// For API-only marketplaces (shopify, woocommerce) → same path, but they return
// `{ ok, configured }` instead of session state — we map `configured && ok`
// to "valid".
// For mp without a bot endpoint (unknown) → state="unreachable".
// ─────────────────────────────────────────────────────────────────────────────

interface UnifiedMarketplaceStatus {
  state: 'valid' | 'invalid' | 'unreachable' | 'unknown';
  checked_at: string;
  message: string | null;
  /** For api-only mps: true if credentials are configured in settings. */
  configured?: boolean;
}

type UnifiedAuthBundle = Record<string, UnifiedMarketplaceStatus>;

// Marketplaces backed by API tokens (no browser-login). Their bots respond
// with `{ configured: bool }` — we treat configured+ok as 'valid'.
const API_ONLY = new Set(['shopify', 'woocommerce']);

// Aliases that the dashboard might query but which are actually duplicates
// of another bot (handled by orchestrator routing). Excluded from polling.
const SKIP = new Set(['subito', 'ricardo']);

const CACHE_TTL_MS = 12_000; // 12s — short enough to feel live, long enough to keep <2 req/s
const cache = new Map<number, { at: number; bundle: UnifiedAuthBundle }>();

async function probeMarketplace(
  mp: string,
  base: string,
  accountId: number,
): Promise<UnifiedMarketplaceStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const r = await fetch(`${base}/api/auth/status?account_id=${accountId}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) {
      return { state: 'invalid', checked_at: checkedAt, message: `HTTP ${r.status}` };
    }
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      configured?: boolean;
      error?: string;
      message?: string;
    };
    if (API_ONLY.has(mp)) {
      if (data.configured && data.ok) {
        return { state: 'valid', checked_at: checkedAt, message: null, configured: true };
      }
      if (data.configured) {
        return {
          state: 'invalid',
          checked_at: checkedAt,
          message: data.error ?? 'Token konfiguriert, aber Shop nicht erreichbar.',
          configured: true,
        };
      }
      return {
        state: 'invalid',
        checked_at: checkedAt,
        message: 'API-Token / Schlüssel noch nicht hinterlegt.',
        configured: false,
      };
    }
    // Browser-based bot. `ok: true` means session valid.
    return {
      state: data.ok ? 'valid' : 'invalid',
      checked_at: checkedAt,
      message: data.ok ? null : (data.message ?? data.error ?? 'Session ungültig — Login nötig.'),
    };
  } catch (err) {
    return {
      state: 'unreachable',
      checked_at: checkedAt,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

authRouter.get('/all-status', async (req, res) => {
  const accountId = Number(req.query.account_id ?? req.query.account ?? 1);
  const cached = cache.get(accountId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.bundle);
  }
  const entries = Object.entries(BOT_ENDPOINTS).filter(([id]) => !SKIP.has(id));
  const results = await Promise.all(
    entries.map(async ([id, base]) => [id, await probeMarketplace(id, base, accountId)] as const),
  );
  const bundle: UnifiedAuthBundle = Object.fromEntries(results);
  cache.set(accountId, { at: Date.now(), bundle });
  res.json(bundle);
});

// Legacy /status endpoint — kept for backward-compat with existing useAuthStatus
// hook. Returns the same vinted-shaped record but now also exposes other bots'
// states via the unified shape, mapped to BotAuth.
authRouter.get('/status', async (req, res) => {
  const accountId = Number(req.query.account_id ?? req.query.account ?? 1);
  const vintedRes = await Promise.allSettled([
    callBot<BotAuthStatus>(VINTED, '/login/status'),
  ]).then(([r]) => r);

  // Also include compact status for all other marketplaces (browser-based +
  // api-only). The dashboard reads this to render badges across the grid.
  const otherEntries = Object.entries(BOT_ENDPOINTS).filter(
    ([id]) => id !== 'vinted' && !SKIP.has(id),
  );
  const otherResults = await Promise.all(
    otherEntries.map(async ([id, base]) => {
      const s = await probeMarketplace(id, base, accountId);
      const sessionState =
        s.state === 'valid' ? 'valid' :
        s.state === 'invalid' ? 'invalid' :
        s.state === 'unreachable' ? 'checking' : 'unknown';
      return [id, {
        session: { state: sessionState, checked_at: s.checked_at, message: s.message },
        login:   { state: 'idle', message: '', started_at: null, finished_at: null },
      }] as const;
    }),
  );

  res.json({
    vinted:
      vintedRes.status === 'fulfilled'
        ? vintedRes.value
        : { error: String(vintedRes.reason) },
    ...Object.fromEntries(otherResults),
  });
});

authRouter.post('/vinted/login', async (_req, res) => {
  try {
    const r = await callBot<{ ok: boolean; status: BotAuthStatus['login'] }>(
      VINTED,
      '/login/start',
      { method: 'POST' },
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
