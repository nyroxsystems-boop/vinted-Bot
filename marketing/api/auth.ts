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
// Public sign helper (used by routes below)
// ──────────────────────────────────────────────────────────────────────────────
export function issueSession(res: Response, user: { id: number; email: string }, jwtSecret: string) {
  const token = signJwt({ uid: user.id, email: user.email }, jwtSecret);
  setSessionCookie(res, token);
}
