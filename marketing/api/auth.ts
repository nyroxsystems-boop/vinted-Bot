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
  created_at: string;
}

export interface AuthedRequest extends Request {
  user?: { id: number; email: string };
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
  `);

  // Tag the licenses table with user_id if missing — backwards-compatible
  // additive migration (existing rows have NULL until back-filled by email match).
  const cols = db.prepare(`PRAGMA table_info(licenses)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'user_id')) {
    db.exec(`ALTER TABLE licenses ADD COLUMN user_id INTEGER REFERENCES users(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id)`);
    console.log('[auth] migrated licenses table → added user_id column');
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
): UserRow {
  const r = db
    .prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`)
    .run(email.toLowerCase(), passwordHash);
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
// Public sign helper (used by routes below)
// ──────────────────────────────────────────────────────────────────────────────
export function issueSession(res: Response, user: { id: number; email: string }, jwtSecret: string) {
  const token = signJwt({ uid: user.id, email: user.email }, jwtSecret);
  setSessionCookie(res, token);
}
