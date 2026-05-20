// Bearer-token bootstrap for Orchestrator <-> Dashboard auth.
//
// Token resolution order:
//   1. `BLACKRUBY_ORCH_TOKEN` env-var (CI / explicit override).
//   2. token-file at `BLACKRUBY_AUTH_TOKEN_PATH` (or `./data/auth-token.txt`).
//   3. fresh `randomBytes(32).toString('hex')` written to the token-file with
//      mode 0600 so only the running user can read it.
//
// The orchestrator exposes the live token at `GET /auth/token` for clients
// running on the same host (loopback-only), so the Tauri shell / dashboard
// can pick it up at boot without the user copy-pasting it.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOKEN_FILE =
  process.env.BLACKRUBY_AUTH_TOKEN_PATH ||
  join(process.cwd(), 'data', 'auth-token.txt');

export function getOrCreateAuthToken(): string {
  if (process.env.BLACKRUBY_ORCH_TOKEN && process.env.BLACKRUBY_ORCH_TOKEN.trim().length > 0) {
    return process.env.BLACKRUBY_ORCH_TOKEN.trim();
  }
  if (existsSync(TOKEN_FILE)) {
    const existing = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing.length > 0) return existing;
  }
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  const tok = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_FILE, tok, { mode: 0o600 });
  return tok;
}
