// Bearer-token gate for the Orchestrator HTTP surface.
//
// The token is created (or loaded) by `getOrCreateAuthToken()` from the
// shared package. Clients running on the same host can fetch it via
// `GET /auth/token` (loopback-only — see index.ts). Everything else must
// present `Authorization: Bearer <token>`.

import type { Request, Response, NextFunction } from 'express';
import { getOrCreateAuthToken } from '@vinted-system/shared/auth-token';

const TOKEN = getOrCreateAuthToken();

// Bypass list — health endpoints stay pingable without auth so the Tauri
// shell can wait for the orchestrator to come up before requesting the
// token, and so deep-health monitoring keeps working.
//
// `/stream` is on the bypass because EventSource cannot send `Authorization`
// headers from the browser. The endpoint is read-only (server-sent events)
// and only emits on the loopback bind — same trust boundary as `/auth/token`
// itself, which already hands the bearer to any loopback caller.
//
// `/api/products/image` and `/api/assets/*` are bypassed because <img src>
// tags cannot send Authorization headers. These routes are
// path-whitelisted server-side via `safeResolveAssetPath` so unauthorized
// filesystem traversal is impossible — auth gate on top would just block
// every product photo in the dashboard.
const BYPASS_PATHS = [
  '/health',
  '/health/deep',
  '/auth/token',
  '/stream',
  '/api/products/image',
  '/api/assets/',
];

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Path-match: exact OR with-query-string OR (for trailing-slash paths)
  // any subpath. Previous version only matched exact + with-query, so
  // `/api/assets/` was on the bypass list but `/api/assets/products/12.jpg`
  // got 401'd — `<img src=…>` tags can't send Authorization headers so
  // those URLs MUST be bypassed. Audit Finding #18.
  if (BYPASS_PATHS.some(p => {
    if (req.path === p) return true;
    if (req.path.startsWith(p + '?')) return true;
    // Path is a trailing-slash bypass-prefix → any subpath is bypassed.
    if (p.endsWith('/') && req.path.startsWith(p)) return true;
    return false;
  })) {
    return next();
  }
  const hdr = req.header('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token || token !== TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

export function getAuthToken(): string {
  return TOKEN;
}
