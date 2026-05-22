// ──────────────────────────────────────────────────────────────────────────────
// Auth — bcrypt password hashing + JWT session in HTTP-only cookie.
//
// Cookie strategy: a single 'br_session' cookie carrying a JWT signed with the
// LICENSE_SIGNING_SECRET (already env-required). Cookies are HTTP-only,
// SameSite=Lax, and Secure in production so the marketing site under
// https://blackruby.de holds them safely while local dev (http://localhost)
// still works.
//
// Why JWT not server sessions? We're stateless — the marketing API can scale
// horizontally without sticky sessions, and the same secret already used for
// license HMAC signing covers session integrity.
// ──────────────────────────────────────────────────────────────────────────────

import bcrypt from 'bcryptjs';
import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';

const COOKIE_NAME = 'br_session';
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days
const IS_PROD = process.env.NODE_ENV === 'production';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  is_admin: number; // SQLite stores BOOLEAN as 0/1
  created_at: string;
}

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; name?: string | null; is_admin?: boolean };
}

// ──────────────────────────────────────────────────────────────────────────────
// DB schema
// ──────────────────────────────────────────────────────────────────────────────
export function ensureAuthSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      stripe_customer TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel    TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_channel_time ON chat_messages(channel, created_at);

    -- Password-reset tokens. Single-use, 30 min TTL. Used_at lets us audit
    -- which token consumed the change; expired/used tokens stay in the table
    -- as a short audit trail (purged > 30 d by cleanup job, not yet wired).
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token);
    CREATE INDEX IF NOT EXISTS idx_pwreset_user  ON password_resets(user_id, created_at);

    -- Stripe webhook idempotency. Each Stripe event arrives with a unique id —
    -- we INSERT-OR-IGNORE on first sight, IGNORE on retries. Without this a
    -- transient handler failure that returns 500 would cause Stripe to retry
    -- and we might issue a duplicate license / fire a duplicate email.
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id    TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload_size INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, processed_at);

    -- Desktop session login history — not a session store (sessions are
    -- stateless), but a thin audit log so we can see how often a user is
    -- logging in and from how many devices. Useful for fraud / sharing
    -- detection later (current MVP doesn't enforce a device limit).
    CREATE TABLE IF NOT EXISTS desktop_logins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      machine_id  TEXT,
      ip_hash     TEXT,
      user_agent  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_desktop_logins_user ON desktop_logins(user_id, created_at);

    -- Short-lived pairing codes for the desktop app. The desktop webview
    -- can't run Google's OAuth iframe (tauri:// is not an authorised
    -- origin), so users who signed up via Google use this device-code
    -- flow instead: log in on blackruby.de/members, click "Verbinde
    -- Desktop", get a 6-char code, type it into the app. The code maps
    -- to a user_id and expires after 10 minutes; consumed flag prevents
    -- replay even if the code leaks before expiry.
    CREATE TABLE IF NOT EXISTS desktop_pair_codes (
      code        TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      expires_at  TEXT NOT NULL,
      consumed_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pair_codes_user ON desktop_pair_codes(user_id, created_at);

    -- Browser-OAuth link tokens. The new "Mit Google anmelden" path opens
    -- the user's default browser, completes the existing web OAuth flow
    -- there (where blackruby.de IS an authorised origin), then signals
    -- back to the desktop via polling. Flow:
    --
    --   1. Desktop: generate 32-byte random token, POST /link-init.
    --   2. Desktop: open https://blackruby.de/desktop-link?token=... in
    --      the user's default browser via Tauri shell.
    --   3. Browser page: ensures user is logged in (regular flow incl.
    --      Google OAuth) → POST /link-confirm with token → token row
    --      flips to status='confirmed' bound to user_id.
    --   4. Desktop polls /link-poll every 2 s.
    --   5. When status='confirmed', poll consumes the token and returns
    --      the signed desktop-session payload in the same response.
    --
    -- A status of 'consumed' lets us serve the response exactly once and
    -- distinguishes "the user clicked confirm and the desktop already
    -- picked it up" from "still pending".
    CREATE TABLE IF NOT EXISTS desktop_link_tokens (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER,
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | consumed
      expires_at  TEXT NOT NULL,
      confirmed_at TEXT,
      consumed_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_link_tokens_status ON desktop_link_tokens(status, created_at);
  `);

  // Tag the licenses table with user_id if missing — backwards-compatible
  // additive migration (existing rows have NULL until back-filled by email match).
  const cols = db.prepare(`PRAGMA table_info(licenses)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'user_id')) {
    db.exec(`ALTER TABLE licenses ADD COLUMN user_id INTEGER REFERENCES users(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id)`);
    console.log('[auth] migrated licenses table → added user_id column');
  }

  // users.name + users.is_admin migrations — additive, NULL/0 defaults are
  // safe for any existing rows. `name` is the display handle used in the
  // member-area chat; `is_admin` gates future moderator UI.
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'name')) {
    db.exec(`ALTER TABLE users ADD COLUMN name TEXT`);
    console.log('[auth] migrated users table → added name column');
  }
  if (!userCols.some((c) => c.name === 'is_admin')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
    console.log('[auth] migrated users table → added is_admin column');
  }

  // Bootstrap admins: any user whose email appears in ADMIN_EMAILS (comma-
  // separated env var) gets is_admin=1 set on startup. Idempotent — re-runs
  // safely. Lets you promote yourself by adding an env-var on Railway
  // without writing a one-off SQL migration.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length) {
    const ph = adminEmails.map(() => '?').join(',');
    const r = db.prepare(`UPDATE users SET is_admin = 1 WHERE email IN (${ph}) AND is_admin = 0`).run(...adminEmails);
    if (r.changes > 0) console.log(`[auth] promoted ${r.changes} user(s) to admin via ADMIN_EMAILS`);
  }

  // First-user-is-admin fallback: if no admins exist yet AND a user with
  // id=1 is present, promote them. This is the "owner of the deployment"
  // pattern — whoever registered first on a fresh install owns it. Safe
  // for single-tenant self-hosted deploys (where blackruby.de runs). On a
  // multi-tenant SaaS we'd skip this; right now Blackruby is single-tenant.
  //
  // Idempotent: once at least one admin exists this branch is a no-op.
  const anyAdmin = db.prepare(`SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1`).get();
  if (!anyAdmin) {
    const firstUser = db.prepare(`SELECT id, email FROM users WHERE id = 1`).get() as
      | { id: number; email: string }
      | undefined;
    if (firstUser) {
      db.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(firstUser.id);
      console.log(`[auth] bootstrapped user_id=1 (${firstUser.email}) as admin — no other admins existed`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Password hashing + JWT
// ──────────────────────────────────────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function signJwt(payload: { uid: number; email: string }, secret: string): string {
  const opts: SignOptions = { expiresIn: COOKIE_MAX_AGE_S };
  return jwt.sign(payload, secret, opts);
}
function verifyJwt(token: string, secret: string): { uid: number; email: string } | null {
  try {
    const dec = jwt.verify(token, secret) as JwtPayload & { uid?: number; email?: string };
    if (typeof dec.uid !== 'number' || typeof dec.email !== 'string') return null;
    return { uid: dec.uid, email: dec.email };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cookie helpers
// ──────────────────────────────────────────────────────────────────────────────
export function setSessionCookie(res: Response, token: string) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_S}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
export function clearSessionCookie(res: Response) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie ?? '';
  for (const piece of raw.split(/;\s*/)) {
    const [k, ...rest] = piece.split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────────
export function makeAuthMiddleware(jwtSecret: string) {
  return function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
    const token = readSessionCookie(req);
    if (!token) return next();
    const v = verifyJwt(token, jwtSecret);
    if (v) req.user = { id: v.uid, email: v.email };
    next();
  };
}
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
  next();
}

// ──────────────────────────────────────────────────────────────────────────────
// User CRUD (thin wrappers around prepared statements)
// ──────────────────────────────────────────────────────────────────────────────
export function findUserByEmail(db: Database.Database, email: string): UserRow | undefined {
  return db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as UserRow | undefined;
}
export function findUserById(db: Database.Database, id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}
export function createUser(
  db: Database.Database,
  email: string,
  passwordHash: string,
  name?: string | null,
): UserRow {
  const r = db
    .prepare(`INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)`)
    .run(email.toLowerCase(), passwordHash, (name ?? null) as string | null);
  return findUserById(db, Number(r.lastInsertRowid))!;
}
export function bindLicensesToUser(db: Database.Database, userId: number, email: string) {
  // Any licenses issued before the user registered (anonymous Stripe checkout)
  // can be claimed by email-match on first login.
  db.prepare(`UPDATE licenses SET user_id = ? WHERE user_id IS NULL AND email = ?`).run(
    userId,
    email.toLowerCase(),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Desktop pair codes — short-lived link between an authenticated web session
// and a desktop install. See the table comment in ensureAuthSchema for the
// flow. Codes are 6 alphanumeric chars (no I/O/0/1 to avoid look-alike pairs).
// ──────────────────────────────────────────────────────────────────────────────

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPairCode(): string {
  const buf = new Uint8Array(6);
  // Web Crypto is available in Node 18+ via the global `crypto` object.
  (globalThis.crypto as Crypto).getRandomValues(buf);
  let out = '';
  for (const b of buf) out += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
  return out;
}

export interface PairCodeRow {
  code: string;
  user_id: number;
  expires_at: string;
  consumed_at: string | null;
}

const PAIR_TTL_MIN = 10;

/** Create a new pair code for `userId`. Invalidates any previously-issued
 *  un-consumed codes for the same user so only one is active at a time. */
export function createPairCode(db: Database.Database, userId: number): PairCodeRow {
  // Mark prior un-consumed codes as consumed (silently expire them) so
  // anyone watching for "your code is X" can't reuse a stale one.
  db.prepare(
    `UPDATE desktop_pair_codes SET consumed_at = datetime('now')
       WHERE user_id = ? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')`,
  ).run(userId);
  // Retry on the astronomically-rare collision (32^6 ≈ 1 in 10^9 per user).
  for (let i = 0; i < 5; i++) {
    const code = randomPairCode();
    const expiresAt = new Date(Date.now() + PAIR_TTL_MIN * 60_000).toISOString();
    try {
      db.prepare(
        `INSERT INTO desktop_pair_codes (code, user_id, expires_at) VALUES (?, ?, ?)`,
      ).run(code, userId, expiresAt);
      return { code, user_id: userId, expires_at: expiresAt, consumed_at: null };
    } catch (e) {
      // SQLITE_CONSTRAINT_PRIMARYKEY → retry
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  throw new Error('pair-code collision after 5 retries — RNG broken?');
}

/** Consume a pair code. Returns the associated user_id on success, null on
 *  unknown/expired/already-consumed. Uses a single UPDATE-with-RETURNING to
 *  keep the consume operation atomic — no TOCTOU window between SELECT and
 *  UPDATE that would let two desktop installs race for the same code. */
export function consumePairCode(db: Database.Database, code: string): number | null {
  const upper = code.trim().toUpperCase();
  const row = db
    .prepare(
      `UPDATE desktop_pair_codes
          SET consumed_at = datetime('now')
        WHERE code = ?
          AND consumed_at IS NULL
          AND datetime(expires_at) > datetime('now')
        RETURNING user_id`,
    )
    .get(upper) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Browser-OAuth link tokens — see the table comment in ensureAuthSchema for
// the full flow. Tokens are 32 bytes (256 bits) of cryptographic randomness,
// hex-encoded so they survive HTTP query strings without escaping. TTL is
// 10 minutes — long enough for the user to walk through a Google OAuth flow,
// short enough that an abandoned tab can't be replayed an hour later.
// ──────────────────────────────────────────────────────────────────────────────

const LINK_TOKEN_TTL_MIN = 10;

export interface LinkTokenRow {
  token: string;
  user_id: number | null;
  status: 'pending' | 'confirmed' | 'consumed';
  expires_at: string;
  confirmed_at: string | null;
  consumed_at: string | null;
}

/** Insert a new pending link token. The caller (desktop) generates the
 *  token bytes locally so the secret never leaves the desktop — the
 *  server just records the fact that "this token is awaiting confirmation". */
export function startLinkToken(db: Database.Database, token: string): LinkTokenRow {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) {
    throw new Error('invalid_link_token');
  }
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MIN * 60_000).toISOString();
  // INSERT OR IGNORE means re-calling /link-init with the same token is a
  // no-op rather than an error — handy for nervous-retrying desktop code.
  db.prepare(
    `INSERT OR IGNORE INTO desktop_link_tokens (token, status, expires_at) VALUES (?, 'pending', ?)`,
  ).run(token, expiresAt);
  return getLinkToken(db, token)!;
}

export function getLinkToken(db: Database.Database, token: string): LinkTokenRow | null {
  const row = db.prepare(`SELECT * FROM desktop_link_tokens WHERE token = ?`).get(token) as
    | LinkTokenRow
    | undefined;
  return row ?? null;
}

/** Bind `userId` to a pending token. Used by the browser-side /link-confirm
 *  route after the web app has authenticated the user. Returns true if the
 *  token was pending and is now confirmed, false otherwise. */
export function confirmLinkToken(db: Database.Database, token: string, userId: number): boolean {
  const r = db
    .prepare(
      `UPDATE desktop_link_tokens
          SET user_id = ?, status = 'confirmed', confirmed_at = datetime('now')
        WHERE token = ?
          AND status = 'pending'
          AND datetime(expires_at) > datetime('now')`,
    )
    .run(userId, token);
  return r.changes > 0;
}

/** Consume a confirmed token. Atomic UPDATE-RETURNING: only the first
 *  desktop poll after confirmation gets the user_id back; later polls and
 *  hostile replays see status='consumed' and get nothing. */
export function consumeLinkToken(db: Database.Database, token: string): number | null {
  const row = db
    .prepare(
      `UPDATE desktop_link_tokens
          SET status = 'consumed', consumed_at = datetime('now')
        WHERE token = ?
          AND status = 'confirmed'
          AND datetime(expires_at) > datetime('now')
        RETURNING user_id`,
    )
    .get(token) as { user_id: number | null } | undefined;
  return row?.user_id ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public sign helper (used by routes below)
// ──────────────────────────────────────────────────────────────────────────────
export function issueSession(res: Response, user: { id: number; email: string }, jwtSecret: string) {
  const token = signJwt({ uid: user.id, email: user.email }, jwtSecret);
  setSessionCookie(res, token);
}
