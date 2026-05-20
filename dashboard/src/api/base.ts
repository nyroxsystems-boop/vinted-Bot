// ──────────────────────────────────────────────────────────────────────────────
// API base-URL resolution.
//
// Order of precedence for the orchestrator origin:
//   1. localStorage  `br_orchestrator_origin`  — set by user in Settings,
//      survives reload, takes priority so support can override at runtime.
//   2. build-time env `VITE_ORCHESTRATOR_ORIGIN` — baked into signed builds.
//   3. dev/self-hosted: relative path (Vite proxy / same-origin server).
//   4. Tauri fallback: http://127.0.0.1:<port>, where <port> comes from
//      `VITE_ORCHESTRATOR_PORT` or defaults to 4700.
//
// Dev-mode (Vite): served from http://localhost:5173 with a /api proxy → 4700.
// Production Tauri: served from http://tauri.localhost — no proxy, so we
// must hit the orchestrator's absolute URL.
// ──────────────────────────────────────────────────────────────────────────────

const LS_KEY = 'br_orchestrator_origin';

const ENV_ORIGIN  = (import.meta.env.VITE_ORCHESTRATOR_ORIGIN as string | undefined)?.trim();
const ENV_PORT    = (import.meta.env.VITE_ORCHESTRATOR_PORT   as string | undefined)?.trim();
const DEFAULT_PORT = ENV_PORT && /^\d+$/.test(ENV_PORT) ? ENV_PORT : '4700';
const FALLBACK_ORIGIN = `http://127.0.0.1:${DEFAULT_PORT}`;

function readOverride(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(LS_KEY);
    return v && v.trim().length > 0 ? v.trim().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function resolveApiBase(): string {
  if (typeof window === 'undefined') return '';

  // Manual override wins. Useful when running a remote orchestrator or when
  // support needs to point a customer at a different port.
  const override = readOverride();
  if (override) return override;

  // Build-time baked-in origin (CI/signed builds).
  if (ENV_ORIGIN) return ENV_ORIGIN;

  const { hostname, protocol } = window.location;

  // Tauri custom scheme (tauri://) — rare but exists.
  if (protocol === 'tauri:') return FALLBACK_ORIGIN;

  // Tauri v2 on macOS/Linux uses the reserved "tauri.localhost" hostname.
  if (hostname === 'tauri.localhost' || hostname.endsWith('.tauri.localhost')) {
    return FALLBACK_ORIGIN;
  }

  // file:// loads need the absolute origin too.
  if (protocol === 'file:') return FALLBACK_ORIGIN;

  // Everything else (dev server on localhost:5173, self-hosted deploys
  // behind a reverse proxy): relative paths work.
  return '';
}

const BASE = resolveApiBase();

/** Build an absolute (or relative) URL for an API request. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${BASE}${path}`;
}

/** EventSource URL for SSE streams. */
export function streamUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${BASE}${path}`;
}

/** The currently resolved origin — empty for same-origin (dev/proxy mode). */
export function currentApiOrigin(): string {
  return BASE;
}

/** Persist a manual override (e.g. user enters `http://127.0.0.1:4720` in
 *  Settings). Pass an empty string to clear and fall back to defaults. */
export function setOrchestratorOriginOverride(value: string): void {
  try {
    if (value.trim().length === 0) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, value.trim().replace(/\/$/, ''));
    }
    // Force a full reload so every module picks up the new BASE.
    window.location.reload();
  } catch {
    /* localStorage unavailable — nothing we can do */
  }
}

/** Ping the orchestrator's /health endpoint. Resolves true if it responds
 *  with a 2xx status within `timeoutMs`, false otherwise (including timeouts,
 *  network errors, and non-OK statuses). */
export async function pingOrchestrator(timeoutMs = 2_500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
