// ──────────────────────────────────────────────────────────────────────────────
// Blackruby Marketing API
//
// Endpoints:
//   POST /api/checkout                   → Stripe Checkout Session (returns URL)
//   GET  /api/checkout/result            → Resolve session → license key
//   POST /api/license/lookup             → Lookup by (email, key)
//   POST /api/license/resend             → Resend license key to email
//   POST /api/license/validate           → Validate from desktop app (signed)
//   GET  /api/releases/latest            → Latest release manifest for downloads
//   POST /api/stripe/webhook             → Stripe webhook (license issuance)
//
// Storage: SQLite (data/marketing.db).
// Notes:   For local dev without a real Stripe key, the API runs in MOCK mode
//          and issues real-looking license keys you can copy/paste. In prod,
//          set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_* and
//          the mock paths short-circuit.
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import Database from 'better-sqlite3';
import { randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import {
  ensureAuthSchema,
  hashPassword,
  verifyPassword,
  makeAuthMiddleware,
  requireAuth,
  findUserByEmail,
  createUser,
  bindLicensesToUser,
  issueSession,
  clearSessionCookie,
  type AuthedRequest,
} from './auth.js';
import { sendLicenseEmail, sendWelcomeEmail } from './mail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(resolve(DATA_DIR, 'marketing.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key            TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    tier           TEXT NOT NULL CHECK (tier IN ('starter','hustler','lifetime')),
    cadence        TEXT NOT NULL CHECK (cadence IN ('monthly','yearly','lifetime')),
    status         TEXT NOT NULL CHECK (status IN ('active','cancelled','expired')) DEFAULT 'active',
    stripe_customer TEXT,
    stripe_sub      TEXT,
    issued_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
  CREATE INDEX IF NOT EXISTS idx_licenses_sub   ON licenses(stripe_sub);

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    session_id TEXT PRIMARY KEY,
    license_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Auth + chat schema (additive, idempotent)
ensureAuthSchema(db);

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const LICENSE_SIGNING_SECRET = (() => {
  const v = process.env.LICENSE_SIGNING_SECRET;
  if (!v || v === 'dev-only-secret-change-me-in-prod') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LICENSE_SIGNING_SECRET must be set in production');
    }
    console.warn('[license] using INSECURE dev-only HMAC secret — set LICENSE_SIGNING_SECRET in production');
    return 'dev-only-secret-change-me-in-prod';
  }
  return v;
})();
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:5180';

const PRICE_IDS: Record<string, string | undefined> = {
  'starter-monthly': process.env.STRIPE_PRICE_STARTER_MONTHLY,
  'hustler-monthly': process.env.STRIPE_PRICE_HUSTLER_MONTHLY,
};

const MOCK_MODE = !STRIPE_KEY;

// In production without Stripe, refuse to issue licenses but allow the server
// to boot so the marketing site keeps serving. Previously this throw'd on boot,
// taking down the whole site if the user hadn't filled Stripe keys yet.
// `CHECKOUT_DISABLED` short-circuits the purchase endpoints with a 503; the
// game-over scenario (MOCK_MODE quietly issuing free licenses in prod) is
// still blocked by checking this flag at request time.
const CHECKOUT_DISABLED = MOCK_MODE && process.env.NODE_ENV === 'production';
if (CHECKOUT_DISABLED) {
  console.error(
    '[server] STRIPE_SECRET_KEY missing in production — checkout endpoints disabled. ' +
    'Marketing site will serve, but /api/checkout and /api/stripe/webhook return 503 ' +
    'until Stripe keys are configured.',
  );
} else if (MOCK_MODE) {
  console.warn('[server] MOCK_MODE active — checkout issues free licenses. dev only.');
}

const stripe = MOCK_MODE ? null : new Stripe(STRIPE_KEY, { apiVersion: '2024-04-10' });

const app = express();
app.use(cors());

// Stripe webhook needs the raw body — register BEFORE express.json().
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response) => {
    if (CHECKOUT_DISABLED) {
      return res.status(503).json({ ok: false, error: 'Stripe not configured on this deployment.' });
    }
    if (MOCK_MODE) return res.json({ ok: true, mock: true });
    const sig = req.headers['stripe-signature'] as string | undefined;
    // Fail-loud if webhook secret is not configured. Only allow signature-skip
    // in explicit MOCK_MODE=true. Returning 403 (not 400) so misconfigured prod
    // environments are visible in Stripe dashboard error metrics.
    if (!STRIPE_WEBHOOK_SECRET) {
      if (process.env.MOCK_MODE === 'true') {
        console.warn('[stripe webhook] MOCK_MODE=true — skipping signature verification');
        // Fall through with no verification; only safe in dev.
      } else {
        console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET missing — refusing webhook');
        return res.status(403).send('Webhook secret not configured');
      }
    }
    if (!sig && process.env.MOCK_MODE !== 'true') {
      return res.status(400).send('No signature');
    }
    let event: Stripe.Event;
    try {
      if (STRIPE_WEBHOOK_SECRET && sig) {
        event = stripe!.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } else {
        // MOCK_MODE bypass — parse body directly.
        event = JSON.parse(req.body.toString()) as Stripe.Event;
      }
    } catch (err) {
      console.error('[stripe webhook] signature failed', err);
      return res.status(400).send('Invalid signature');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      handleCheckoutCompleted(session).catch((e) => console.error('handle err', e));
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      db.prepare(`UPDATE licenses SET status='cancelled' WHERE stripe_sub = ?`).run(sub.id);
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      // Cancel-at-period-end: customer hit "cancel" but is paid-through end of
      // billing period → license stays ACTIVE until current_period_end, then
      // the customer.subscription.deleted webhook fires.
      // Status 'canceled': hard-cancel, expires_at = now.
      // Otherwise: 'active'/'trialing' → live, anything else (past_due, unpaid,
      // paused, incomplete) → cancelled until customer fixes payment.
      let newStatus: 'active' | 'cancelled';
      let periodEnd: string | null;
      if (sub.status === 'canceled') {
        newStatus = 'cancelled';
        periodEnd = new Date().toISOString();
      } else if (sub.cancel_at_period_end === true) {
        newStatus = 'active';
        periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      } else {
        const liveStatuses: ReadonlyArray<Stripe.Subscription.Status> = ['active', 'trialing'];
        newStatus = liveStatuses.includes(sub.status) ? 'active' : 'cancelled';
        periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      }
      db.prepare(`UPDATE licenses SET status = ?, expires_at = ? WHERE stripe_sub = ?`).run(newStatus, periodEnd, sub.id);
    } else if (event.type === 'invoice.payment_succeeded') {
      // Renewal — push expires_at forward to the new period end.
      const inv = event.data.object as Stripe.Invoice;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
      if (subId) {
        const lineEnd = inv.lines.data[0]?.period?.end;
        const periodEnd = lineEnd ? new Date(lineEnd * 1000).toISOString() : null;
        db.prepare(`UPDATE licenses SET status='active', expires_at = COALESCE(?, expires_at) WHERE stripe_sub = ?`).run(periodEnd, subId);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as Stripe.Invoice;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
      // Don't kill the license on the first failure — Stripe retries. We only
      // hard-cancel via `customer.subscription.updated` → past_due/unpaid.
      // But log it so we can see retries.
      if (subId) console.warn(`[stripe] invoice payment failed for sub ${subId}`);
    }

    res.json({ received: true });
  },
);

app.use(express.json());

// Attach `req.user` whenever a valid session cookie is present.
app.use(makeAuthMiddleware(LICENSE_SIGNING_SECRET));

// ── Auth routes ─────────────────────────────────────────────────────────────
// POST /api/auth/register  body: { email, password } → 201 + session cookie
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'invalid_input' });
  }
  const existing = findUserByEmail(db, email);
  if (existing) return res.status(409).json({ ok: false, error: 'email_in_use' });
  const hash = await hashPassword(password);
  const user = createUser(db, email, hash);
  bindLicensesToUser(db, user.id, user.email);
  issueSession(res, user, LICENSE_SIGNING_SECRET);
  sendWelcomeEmail({ to: user.email }).catch((e) => console.error('[welcome mail]', e));
  res.status(201).json({ ok: true, user: { id: user.id, email: user.email } });
});

// POST /api/auth/login  body: { email, password } → session cookie
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ ok: false, error: 'invalid_input' });
  const user = findUserByEmail(db, email);
  if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  bindLicensesToUser(db, user.id, user.email);
  issueSession(res, user, LICENSE_SIGNING_SECRET);
  res.json({ ok: true, user: { id: user.id, email: user.email } });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — returns the current user (or null when not logged in)
app.get('/api/auth/me', (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: { id: req.user.id, email: req.user.email } });
});

// ── Members ─────────────────────────────────────────────────────────────────
// GET /api/members/dashboard — current user + their licenses (live status)
app.get('/api/members/dashboard', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  // Re-bind in case licenses were issued to the same email after signup.
  bindLicensesToUser(db, user.id, user.email);
  const licenses = db
    .prepare(
      `SELECT key, tier, cadence, status, stripe_customer, stripe_sub, issued_at, expires_at
         FROM licenses
        WHERE user_id = ? OR email = ?
        ORDER BY issued_at DESC`,
    )
    .all(user.id, user.email);
  res.json({ ok: true, user, licenses });
});

// POST /api/members/portal — Stripe Customer Portal for subscription mgmt
app.post('/api/members/portal', requireAuth, async (req: AuthedRequest, res: Response) => {
  if (MOCK_MODE || !stripe) return res.status(503).json({ ok: false, error: 'stripe_disabled' });
  const user = req.user!;
  // Find any license with a stripe_customer for this user.
  const row = db
    .prepare(
      `SELECT stripe_customer FROM licenses
        WHERE (user_id = ? OR email = ?) AND stripe_customer IS NOT NULL
        LIMIT 1`,
    )
    .get(user.id, user.email) as { stripe_customer: string } | undefined;
  if (!row) return res.status(404).json({ ok: false, error: 'no_subscription' });
  const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blackruby.de';
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer,
    return_url: `${PUBLIC_URL}/members`,
  });
  res.json({ ok: true, url: portal.url });
});

// ── Chat (Discord-style channels with SSE live updates) ─────────────────────
const CHAT_CHANNELS = ['general', 'support', 'sales-wins', 'beta'];

// Pub/sub bus for SSE — Node's EventEmitter is enough for a single-instance
// deployment. If we ever go multi-replica we'll swap this for Redis.
import { EventEmitter } from 'node:events';
const chatBus = new EventEmitter();
chatBus.setMaxListeners(200);

// GET /api/chat/channels
app.get('/api/chat/channels', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json({ ok: true, channels: CHAT_CHANNELS });
});

// GET /api/chat/messages?channel=general — last 100 messages with user emails
app.get('/api/chat/messages', requireAuth, (req: AuthedRequest, res: Response) => {
  const channel = String(req.query.channel ?? 'general');
  if (!CHAT_CHANNELS.includes(channel)) return res.status(400).json({ ok: false, error: 'unknown_channel' });
  const rows = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, u.id AS user_id, u.email AS user_email
         FROM chat_messages m
         JOIN users u ON u.id = m.user_id
        WHERE m.channel = ?
        ORDER BY m.id DESC
        LIMIT 100`,
    )
    .all(channel) as Array<{ id: number; body: string; created_at: string; user_id: number; user_email: string }>;
  res.json({ ok: true, messages: rows.reverse() });
});

// POST /api/chat/post  body: { channel, body }
app.post('/api/chat/post', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const { channel, body } = req.body as { channel?: string; body?: string };
  const text = (body ?? '').trim();
  if (!channel || !CHAT_CHANNELS.includes(channel)) return res.status(400).json({ ok: false, error: 'unknown_channel' });
  if (!text) return res.status(400).json({ ok: false, error: 'empty' });
  if (text.length > 2000) return res.status(400).json({ ok: false, error: 'too_long' });
  const r = db
    .prepare(`INSERT INTO chat_messages (channel, user_id, body) VALUES (?, ?, ?)`)
    .run(channel, user.id, text);
  const msg = {
    id: Number(r.lastInsertRowid),
    channel,
    body: text,
    created_at: new Date().toISOString(),
    user_id: user.id,
    user_email: user.email,
  };
  chatBus.emit(`channel:${channel}`, msg);
  res.json({ ok: true, message: msg });
});

// GET /api/chat/stream?channel=general — Server-Sent-Events live feed
app.get('/api/chat/stream', requireAuth, (req: AuthedRequest, res: Response) => {
  const channel = String(req.query.channel ?? 'general');
  if (!CHAT_CHANNELS.includes(channel)) return res.status(400).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: connected to ${channel}\n\n`);
  const send = (m: unknown) => res.write(`data: ${JSON.stringify(m)}\n\n`);
  const onMsg = (m: unknown) => send(m);
  chatBus.on(`channel:${channel}`, onMsg);

  // Heartbeat every 25s — keeps proxies (Railway edge) from killing the conn.
  const hb = setInterval(() => res.write(`: ping\n\n`), 25_000);

  req.on('close', () => {
    clearInterval(hb);
    chatBus.off(`channel:${channel}`, onMsg);
  });
});

// ── POST /api/checkout ──────────────────────────────────────────────────────
app.post('/api/checkout', async (req: AuthedRequest, res: Response) => {
  if (CHECKOUT_DISABLED) {
    return res.status(503).json({ ok: false, error: 'Checkout temporarily unavailable. Stripe not configured on this deployment.' });
  }
  const { tier } = req.body as {
    tier: 'starter' | 'hustler';
  };
  if (!['starter', 'hustler'].includes(tier)) {
    return res.status(400).json({ ok: false, error: 'invalid tier' });
  }
  // We currently only sell monthly subscriptions — no yearly, no lifetime.
  const cad = 'monthly' as const;

  if (MOCK_MODE) {
    // Generate a license immediately and return a fake success URL.
    const email = `demo+${Date.now()}@blackruby.de`;
    const lic = issueLicense({ email, tier, cadence: cad, stripeCustomer: null, stripeSub: null });
    const sessionId = `mock_${randomBytes(8).toString('hex')}`;
    db.prepare(
      `INSERT INTO checkout_sessions (session_id, license_key) VALUES (?, ?)`,
    ).run(sessionId, lic.key);
    return res.json({ ok: true, url: `${PUBLIC_URL}/success?session_id=${sessionId}`, mock: true });
  }

  const priceId = PRICE_IDS[`${tier}-${cad}`];
  if (!priceId) {
    return res.status(500).json({ ok: false, error: `No Stripe price configured for ${tier}-${cad}` });
  }

  // If the visitor is logged in, pre-fill Stripe Checkout with their email
  // and stamp the user_id into metadata so the webhook can bind cleanly.
  const meta: Record<string, string> = { tier, cadence: cad };
  if (req.user) meta.user_id = String(req.user.id);

  const session = await stripe!.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_URL}/pricing`,
    allow_promotion_codes: true,
    customer_email: req.user?.email,
    // EU MwSt — wir verkaufen B2C an Endverbraucher (Kleinunternehmer-Setup
    // braucht's nicht, alle anderen brauchen es). `automatic_tax` setzt MwSt
    // basierend auf billing-address + Reverse-Charge bei B2B (tax_id_collection).
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    metadata: meta,
  });
  db.prepare(`INSERT INTO checkout_sessions (session_id) VALUES (?)`).run(session.id);
  res.json({ ok: true, url: session.url });
});

// ── GET /api/checkout/result ────────────────────────────────────────────────
app.get('/api/checkout/result', async (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? '');
  if (!sessionId) return res.status(400).json({ ok: false, error: 'missing session_id' });

  const row = db
    .prepare(`SELECT license_key FROM checkout_sessions WHERE session_id = ?`)
    .get(sessionId) as { license_key: string | null } | undefined;

  if (row?.license_key) {
    const lic = db
      .prepare(`SELECT key, email, tier FROM licenses WHERE key = ?`)
      .get(row.license_key) as { key: string; email: string; tier: string } | undefined;
    if (lic) return res.json({ ok: true, key: lic.key, email: lic.email, tier: lic.tier });
  }

  if (MOCK_MODE) {
    return res.status(404).json({ ok: false, error: 'Session unbekannt.' });
  }

  // Real Stripe path: resolve via Stripe and ensure license exists.
  try {
    const session = await stripe!.checkout.sessions.retrieve(sessionId, {
      expand: ['customer'],
    });
    const tier = (session.metadata?.tier as 'starter' | 'hustler') ?? 'hustler';
    const cad = (session.metadata?.cadence as 'monthly') ?? 'monthly';
    const email =
      (typeof session.customer === 'object' && session.customer && 'email' in session.customer
        ? (session.customer.email as string | undefined)
        : null) ?? session.customer_details?.email ?? null;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Stripe-Session ohne E-Mail.' });
    }

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
    const subId = typeof session.subscription === 'string' ? session.subscription : null;

    let lic = db
      .prepare(
        `SELECT key, email, tier FROM licenses
         WHERE (stripe_customer = ? OR stripe_sub = ?)
           AND status IN ('active','cancelled')
         LIMIT 1`,
      )
      .get(customerId, subId) as { key: string; email: string; tier: string } | undefined;

    if (!lic) {
      // Server-side fallback: only issue if Stripe confirms payment. The
      // webhook may still be in-flight or have failed — don't make customers
      // wait or open a support ticket.
      if (session.payment_status !== 'paid') {
        return res.status(402).json({ ok: false, error: 'Zahlung noch nicht bestätigt — gleich nochmal versuchen.' });
      }
      lic = issueLicense({
        email,
        tier,
        cadence: cad,
        stripeCustomer: customerId,
        stripeSub: subId,
      });
      db.prepare(`UPDATE checkout_sessions SET license_key = ? WHERE session_id = ?`).run(lic.key, sessionId);
    } else {
      // Make sure the session ↔ license link is recorded so resends/lookups work.
      db.prepare(`UPDATE checkout_sessions SET license_key = COALESCE(license_key, ?) WHERE session_id = ?`)
        .run(lic.key, sessionId);
    }

    return res.json({ ok: true, key: lic.key, email: lic.email, tier: lic.tier });
  } catch (e) {
    console.error('checkout/result error', e);
    return res.status(500).json({ ok: false, error: 'Stripe-Lookup fehlgeschlagen.' });
  }
});

// ── POST /api/license/lookup ────────────────────────────────────────────────
app.post('/api/license/lookup', (req: Request, res: Response) => {
  const { email, key } = req.body as { email?: string; key?: string };
  if (!email || !key) return res.status(400).json({ ok: false, error: 'E-Mail und Key erforderlich.' });

  const row = db
    .prepare(`SELECT key, email, tier, status, expires_at FROM licenses WHERE email = ? AND key = ?`)
    .get(email.trim().toLowerCase(), key.trim().toUpperCase()) as
    | { key: string; email: string; tier: string; status: string; expires_at: string | null }
    | undefined;

  if (!row) return res.status(404).json({ ok: false, error: 'Keine passende Lizenz gefunden.' });
  res.json({ ok: true, ...row });
});

// ── POST /api/license/resend ────────────────────────────────────────────────
app.post('/api/license/resend', (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ ok: false, error: 'E-Mail erforderlich.' });

  const rows = db
    .prepare(`SELECT key, tier FROM licenses WHERE email = ? AND status = 'active'`)
    .all(email.trim().toLowerCase()) as Array<{ key: string; tier: string }>;

  if (rows.length === 0) {
    // Do not leak whether the email exists.
    return res.json({ ok: true, sent: false });
  }
  // In prod: trigger email job. Here we just acknowledge.
  console.log('[license/resend] would email', email, rows.map((r) => r.key));
  res.json({ ok: true, sent: true });
});

// ── POST /api/license/validate ──────────────────────────────────────────────
// Called by the desktop app on first activation. Returns a signed token the
// app stores locally and verifies offline thereafter (HMAC-SHA256).
app.post('/api/license/validate', async (req: Request, res: Response) => {
  const { key, machine_id } = req.body as { key?: string; machine_id?: string };
  if (!key) return res.status(400).json({ ok: false, error: 'missing key' });

  const row = db
    .prepare(`SELECT key, email, tier, cadence, status, expires_at, stripe_sub FROM licenses WHERE key = ?`)
    .get(key.trim().toUpperCase()) as
    | { key: string; email: string; tier: string; cadence: string; status: string; expires_at: string | null; stripe_sub: string | null }
    | undefined;

  if (!row) return res.status(404).json({ ok: false, error: 'unknown key' });

  // Live subscription check — webhook delivery can lag or fail, so the
  // validate call is the authoritative source of truth for monthly/yearly
  // subscribers. Lifetime keys skip this (no Stripe sub).
  let effectiveStatus = row.status;
  let effectiveExpiresAt = row.expires_at;
  if (!MOCK_MODE && stripe && row.stripe_sub && row.cadence !== 'lifetime') {
    try {
      const sub = await stripe.subscriptions.retrieve(row.stripe_sub);
      const live: ReadonlyArray<Stripe.Subscription.Status> = ['active', 'trialing'];
      effectiveStatus = live.includes(sub.status) ? 'active' : 'cancelled';
      effectiveExpiresAt = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      // Persist what we learned so future validates are fast and webhooks
      // are not the only source of truth.
      db.prepare(`UPDATE licenses SET status = ?, expires_at = COALESCE(?, expires_at) WHERE key = ?`)
        .run(effectiveStatus, effectiveExpiresAt, row.key);
    } catch (e) {
      // Stripe API failure → fall back to DB row. Don't 500 — the user can
      // still use the app, the daily webhook will sync eventually.
      console.warn('[license validate] stripe lookup failed', e instanceof Error ? e.message : e);
    }
  }

  if (effectiveStatus !== 'active') {
    return res.status(403).json({ ok: false, error: `status ${effectiveStatus}` });
  }
  if (effectiveExpiresAt && new Date(effectiveExpiresAt) < new Date()) {
    return res.status(403).json({ ok: false, error: 'expired' });
  }

  const payload = JSON.stringify({
    key: row.key,
    email: row.email,
    tier: row.tier,
    cadence: row.cadence,
    expires_at: effectiveExpiresAt,
    machine_id: machine_id ?? null,
    issued_at: new Date().toISOString(),
  });
  const signature = createHmac('sha256', LICENSE_SIGNING_SECRET).update(payload).digest('hex');
  res.json({
    ok: true,
    payload,
    signature,
    tier: row.tier,
    cadence: row.cadence,
    expires_at: effectiveExpiresAt,
  });
});

// ── GET /api/releases/latest ────────────────────────────────────────────────
const RELEASES_FILE = resolve(__dirname, '../data/releases.json');
app.get('/api/releases/latest', (_req: Request, res: Response) => {
  try {
    if (!existsSync(RELEASES_FILE)) {
      return res.json({ ok: true, release: defaultRelease() });
    }
    const raw = readFileSync(RELEASES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    res.json({ ok: true, release: parsed });
  } catch (e) {
    console.error('releases read err', e);
    res.json({ ok: true, release: defaultRelease() });
  }
});

// ── GET /api/releases/tarball/:current_version ───────────────────────────────
// Lightweight, no-cert in-app updater. The desktop app polls this endpoint
// with its current version; we respond with the manifest of the latest
// source tarball if a newer one is available.
//
// Layout on disk: `dist/release/<version>/system.tar.gz` plus a matching
// `system.tar.gz.sha256` and `system.tar.gz.sig` next to it (the sig is
// detached Ed25519 over the raw tarball bytes, hex-encoded, generated by
// the release script).
//
// `requires_native_reinstall: true` is set when the new version changed any
// Rust file under app/src-tauri — the dashboard then renders a "neuen
// Installer ziehen" banner instead of "jetzt aktualisieren", because we
// can't rewrite a running binary from inside itself.
app.get('/api/releases/tarball/:current_version', (req: Request, res: Response) => {
  try {
    if (!existsSync(RELEASES_FILE)) return res.status(204).end();
    const release = JSON.parse(readFileSync(RELEASES_FILE, 'utf8')) as {
      version: string;
      released_at: string;
      notes: string[];
      tarball?: {
        url: string;
        sha256: string;
        signature: string;
        requires_native_reinstall?: boolean;
      };
    };
    const current = (req.params.current_version ?? '').trim();
    if (!current || cmpSemver(release.version, current) <= 0) {
      return res.json({ ok: true, available: false, current_version: current, latest_version: release.version });
    }
    if (!release.tarball) {
      // We have a newer version but no tarball published yet — user needs to
      // grab the DMG/EXE manually.
      return res.json({
        ok: true,
        available: true,
        version: release.version,
        notes: release.notes,
        requires_native_reinstall: true,
        tarball_url: null,
      });
    }
    return res.json({
      ok: true,
      available: true,
      version: release.version,
      released_at: release.released_at,
      notes: release.notes,
      tarball_url: release.tarball.url,
      sha256: release.tarball.sha256,
      signature: release.tarball.signature,
      requires_native_reinstall: release.tarball.requires_native_reinstall ?? false,
    });
  } catch (e) {
    console.error('tarball manifest err', e);
    return res.status(500).json({ ok: false, error: 'manifest unreadable' });
  }
});

// ── GET /downloads/tarball/:version/system.tar.gz ────────────────────────────
// Serves the signed source tarball. Only the version listed in releases.json
// is served — older versions are 404 to keep the surface area tiny.
app.get('/downloads/tarball/:version/system.tar.gz', (req: Request, res: Response) => {
  try {
    if (!existsSync(RELEASES_FILE)) return res.status(404).send('no releases');
    const release = JSON.parse(readFileSync(RELEASES_FILE, 'utf8')) as { version: string };
    if (req.params.version !== release.version) return res.status(404).send('not the active version');
    const filePath = resolve(RELEASE_ROOT, release.version, 'system.tar.gz');
    if (!filePath.startsWith(RELEASE_ROOT)) return res.status(400).send('invalid');
    if (!existsSync(filePath)) return res.status(404).send('tarball missing');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="system-${release.version}.tar.gz"`);
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : String(e));
  }
});

// ── GET /downloads/:version/:file ─────────────────────────────────────────
// Serves built installers from dist/release/<version>/. Locked-down: only
// files that are listed in releases.json's assets[] are served, so a curious
// curl can't probe arbitrary paths under that directory.
const RELEASE_ROOT = resolve(__dirname, '../../dist/release');
app.get('/downloads/:version/:file', (req: Request, res: Response) => {
  try {
    const { version, file } = req.params;
    if (!version || !file || file.includes('..') || file.includes('/')) {
      return res.status(400).send('invalid path');
    }
    // Check whitelist
    let allowed = false;
    if (existsSync(RELEASES_FILE)) {
      const release = JSON.parse(readFileSync(RELEASES_FILE, 'utf8')) as { assets?: Array<{ name: string }> };
      allowed = (release.assets ?? []).some((a) => a.name === file);
    }
    if (!allowed) return res.status(404).send('not found');

    const filePath = resolve(RELEASE_ROOT, version, file);
    if (!filePath.startsWith(RELEASE_ROOT)) return res.status(400).send('invalid');
    if (!existsSync(filePath)) return res.status(404).send('not found');

    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : String(e));
  }
});

// ── GET /api/releases/:target/:current_version ──────────────────────────────
// Tauri auto-updater endpoint. Returns `{ version, url, signature, notes,
// pub_date }` if a newer version is available, or 204 No-Content if the
// client is already up to date.
//
// `target` is what the updater fills in — values like "darwin-aarch64",
// "darwin-x86_64", "windows-x86_64", "linux-x86_64".
app.get('/api/releases/:target/:current_version', (req: Request, res: Response) => {
  try {
    if (!existsSync(RELEASES_FILE)) return res.status(204).end();
    const release = JSON.parse(readFileSync(RELEASES_FILE, 'utf8')) as {
      version: string;
      released_at: string;
      notes: string[];
      assets: Array<{ name: string; url: string; platform: string; sha256?: string; signature?: string }>;
    };

    if (release.version === req.params.current_version) return res.status(204).end();
    if (cmpSemver(release.version, req.params.current_version ?? '') <= 0) return res.status(204).end();

    const tauriTarget = req.params.target ?? '';
    const platformMap: Record<string, string> = {
      'darwin-aarch64': 'mac-arm64',
      'darwin-x86_64':  'mac-x64',
      'darwin-universal': 'mac-arm64',
      'windows-x86_64': 'windows-x64',
      'linux-x86_64':   'linux-x64',
    };
    const wanted = platformMap[tauriTarget];
    const asset = release.assets.find((a) => a.platform === wanted) ?? release.assets[0];
    if (!asset) return res.status(204).end();

    const publicUrl = process.env.PUBLIC_URL ?? '';
    res.json({
      version: release.version,
      pub_date: release.released_at,
      notes: release.notes.join('\n'),
      url: asset.url.startsWith('http') ? asset.url : `${publicUrl}${asset.url}`,
      signature: asset.signature ?? '',
    });
  } catch (e) {
    console.error('updater err', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/license/refund ────────────────────────────────────────────────
// 7-day money-back guarantee. Verifies key + age < 7d, refunds via Stripe,
// deactivates the license. Mirrors the policy advertised on /pricing.
app.post('/api/license/refund', async (req: Request, res: Response) => {
  const { key, email } = req.body as { key?: string; email?: string };
  if (!key || !email) {
    return res.status(400).json({ ok: false, error: 'key + email required' });
  }
  const row = db
    .prepare(`SELECT key, email, status, stripe_customer, stripe_sub, issued_at, cadence FROM licenses WHERE key = ? AND email = ?`)
    .get(key.trim().toUpperCase(), email.trim().toLowerCase()) as
    | { key: string; email: string; status: string; stripe_customer: string | null; stripe_sub: string | null; issued_at: string; cadence: string }
    | undefined;

  if (!row) return res.status(404).json({ ok: false, error: 'Lizenz nicht gefunden' });
  if (row.status !== 'active') return res.status(400).json({ ok: false, error: `Status ${row.status} — bereits storniert` });

  const ageMs = Date.now() - new Date(row.issued_at).getTime();
  const SEVEN_DAYS = 7 * 86_400_000;
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageMs > SEVEN_DAYS) {
    // 410 Gone signals "the right existed but has expired", per RFC. Subscription
    // customers can still self-cancel via Stripe Customer Portal — that path
    // ends the recurring charge but does NOT refund past payments.
    return res.status(410).json({
      ok: false,
      error: `Refund-Fenster (7 Tage) abgelaufen — Kauf vor ${ageDays} Tagen. Abo kannst du jederzeit kündigen, aber bereits bezahlte Perioden werden nicht erstattet. Wende dich an support@blackruby.de.`,
    });
  }

  if (MOCK_MODE) {
    db.prepare(`UPDATE licenses SET status = 'cancelled' WHERE key = ?`).run(row.key);
    return res.json({ ok: true, refunded_mock: true });
  }

  try {
    // Refund-FIRST policy: only mark the license cancelled after Stripe
    // confirms the refund. Otherwise a Stripe-side failure leaves us with
    // a dead license + customer who paid → support nightmare.
    let refunded = false;
    if (row.stripe_customer) {
      const charges = await stripe!.charges.list({ customer: row.stripe_customer, limit: 1 });
      const charge = charges.data[0];
      if (charge && charge.status === 'succeeded' && !charge.refunded) {
        await stripe!.refunds.create({ charge: charge.id });
        refunded = true;
      }
    }
    // Cancel the active subscription only after refund succeeded (or there
    // was nothing to refund for a fully-refunded charge — still safe to cancel).
    if (row.stripe_sub) {
      await stripe!.subscriptions.cancel(row.stripe_sub).catch((e) =>
        console.warn('[refund] subscription cancel non-fatal', e instanceof Error ? e.message : e),
      );
    }
    db.prepare(`UPDATE licenses SET status = 'cancelled' WHERE key = ?`).run(row.key);
    res.json({ ok: true, refunded });
  } catch (e) {
    // CRITICAL: do not flip the license to cancelled — caller can retry.
    console.error('[refund] stripe error, license remains active', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, mock: MOCK_MODE }));

// POST /api/test/mail  body: { to, secret }  — fires sendLicenseEmail with a
// dummy key so we can verify SMTP wiring end-to-end without going through
// Stripe. Protected by the LICENSE_SIGNING_SECRET so randos can't spam our
// outbound queue.
app.post('/api/test/mail', async (req: Request, res: Response) => {
  const { to, secret, tier = 'starter' } = req.body as { to?: string; secret?: string; tier?: 'starter' | 'hustler' };
  if (secret !== LICENSE_SIGNING_SECRET) return res.status(401).json({ ok: false, error: 'bad_secret' });
  if (!to) return res.status(400).json({ ok: false, error: 'missing_to' });
  try {
    await sendLicenseEmail({
      to,
      licenseKey: 'BRBY-TEST-XXXX-YYYY-ZZZZ-WWWW',
      tier: tier === 'hustler' ? 'hustler' : 'starter',
      amountEur: tier === 'hustler' ? 199 : 99,
    });
    res.json({ ok: true, sent_to: to });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ── Static marketing-site (production single-service deploy) ────────────────
// On Railway / any single-process host we serve the built marketing site
// from the same Node process as the API. The Vite build outputs to
// marketing/dist/. Locally during development the Vite dev-server (port
// 5180) handles HMR; this static fallback only kicks in when dist/
// exists, so it does NOT collide with the dev workflow.
const SITE_DIST = resolve(__dirname, '../dist');
if (existsSync(SITE_DIST)) {
  console.log(`[marketing-api] serving static site from ${SITE_DIST}`);
  app.use(express.static(SITE_DIST));
  // SPA fallback — any non-/api/* path that isn't a real file falls back
  // to index.html so React Router handles client-side routes.
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(SITE_DIST, 'index.html'));
  });
}

const PORT = Number(process.env.PORT ?? 5181);
app.listen(PORT, () => {
  console.log(`[marketing-api] listening on :${PORT} ${MOCK_MODE ? '(MOCK MODE)' : ''}`);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tier = (session.metadata?.tier as 'starter' | 'hustler') ?? 'hustler';
  const cad = (session.metadata?.cadence as 'monthly') ?? 'monthly';
  const email = session.customer_details?.email ?? null;
  if (!email) return;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const subId = typeof session.subscription === 'string' ? session.subscription : null;
  // Either a logged-in user or one whose email already exists in the user table.
  const metaUserId = Number(session.metadata?.user_id ?? 0) || null;
  const userByEmail = findUserByEmail(db, email);
  const userId = metaUserId ?? userByEmail?.id ?? null;
  const amountEur = (session.amount_total ?? (tier === 'hustler' ? 19900 : 9900)) / 100;

  // Idempotency: webhook can fire twice (Stripe retries), and /api/checkout/result
  // may also race ahead. Check by customer OR sub, in active or cancelled states.
  const existing = db
    .prepare(
      `SELECT key FROM licenses
       WHERE (stripe_customer = ? OR stripe_sub = ?)
         AND status IN ('active','cancelled')
       LIMIT 1`,
    )
    .get(customerId, subId) as { key: string } | undefined;
  if (existing) {
    // Still bind the session → license mapping so /checkout/result resolves,
    // and back-fill the user_id if we now know it.
    db.prepare(`UPDATE checkout_sessions SET license_key = COALESCE(license_key, ?) WHERE session_id = ?`)
      .run(existing.key, session.id);
    if (userId) {
      db.prepare(`UPDATE licenses SET user_id = COALESCE(user_id, ?) WHERE key = ?`).run(userId, existing.key);
    }
    return;
  }
  // Belt-and-suspenders: maybe /api/checkout/result already issued + bound this session.
  const bound = db
    .prepare(`SELECT license_key FROM checkout_sessions WHERE session_id = ?`)
    .get(session.id) as { license_key: string | null } | undefined;
  if (bound?.license_key) return;

  const lic = issueLicense({
    email,
    tier,
    cadence: cad,
    stripeCustomer: customerId,
    stripeSub: subId,
  });
  db.prepare(`UPDATE checkout_sessions SET license_key = ? WHERE session_id = ?`).run(lic.key, session.id);
  if (userId) {
    db.prepare(`UPDATE licenses SET user_id = ? WHERE key = ?`).run(userId, lic.key);
  }

  // Fire-and-forget: send the license email. Errors are logged inside mail.ts
  // so the webhook still returns 200 (Stripe should not retry on mail bugs).
  sendLicenseEmail({ to: email, licenseKey: lic.key, tier, amountEur }).catch(() => {});
}

function issueLicense(args: {
  email: string;
  tier: 'starter' | 'hustler';
  cadence: 'monthly';
  stripeCustomer: string | null;
  stripeSub: string | null;
}) {
  const key = generateKey();
  // Monthly subscription — 30-day grace period before re-validation against
  // Stripe (the recurring webhook keeps expires_at pushed forward on each
  // successful invoice.payment_succeeded).
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO licenses (key, email, tier, cadence, stripe_customer, stripe_sub, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(key, args.email.toLowerCase(), args.tier, args.cadence, args.stripeCustomer, args.stripeSub, expiresAt);
  return { key, email: args.email.toLowerCase(), tier: args.tier };
}

function generateKey(): string {
  const bytes = randomBytes(10);
  const segments: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    segments.push(bytes.readUInt16BE(i).toString(36).toUpperCase().padStart(4, '0'));
  }
  return ['BRBY', ...segments].join('-');
}

function cmpSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function defaultRelease() {
  return {
    version: '0.5.0',
    released_at: new Date().toISOString(),
    notes: [
      'Multi-Marketplace v2: Vinted + Kleinanzeigen + eBay-DE als First-Class-Citizens',
      'CJ-Pipeline gehärtet: Pre-Flight Stock/Address-Check, Daily-Caps, Failed-Retry',
      'CAPTCHA Zero-Cost: lokales Whisper + Human-Behavior-Jitter',
      'Per-Plattform LLM-Variants: Vinted (Gen-Z), KA (formal), eBay-DE (SEO)',
      'Auto-Re-List 24 h nach Sale mit Foto-Shuffle, Preis-Jitter, Titel-Variation',
    ],
    assets: [],
  };
}
