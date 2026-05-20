// ──────────────────────────────────────────────────────────────────────────────
// Vinted-Account helpers
//
// Centralized account CRUD + filesystem layout. Every user-scoped
// read/write goes through here so the "which account owns this?" rule is
// enforced in one place.
//
// Folder layout (single source of truth):
//
//   <repo>/data/
//     accounts/
//       <id>/
//         chromium-profile/   ← Playwright persistent context
//         state.json          ← legacy state export (compatibility)
//         labels/             ← per-account shipping-label PDFs
//     db/
//       vinted-system.db      ← shared DB (account_id column scopes rows)
//
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import type { VintedAccount } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Multi-marketplace account identity ──────────────────────────────────────
// `vinted_accounts` is the master table but holds identities for ALL
// marketplaces (the table name is legacy). The `marketplace` column
// (default 'vinted') scopes which platform an account belongs to so a user
// can have e.g. 10 Vinted-Accounts AND 10 eBay-Accounts as separate logins.

/** Marketplace identities a per-account login can target.
 *
 * Must be a subset of `MarketplaceId` from `./marketplace/index.ts` — the
 * smaller union here is intentional: only platforms where a session-cookie
 * or per-account OAuth-token is meaningful. Marketplaces driven by a
 * single API-key (e.g. shopify, woocommerce) don't multiply per account. */
export type PlatformId =
  | 'vinted'
  | 'ebay_de'
  | 'ebay_uk'
  | 'kleinanzeigen'
  | 'depop'
  | 'mercari'
  | 'wallapop'
  | 'etsy';

const PLATFORM_IDS: readonly PlatformId[] = [
  'vinted', 'ebay_de', 'ebay_uk', 'kleinanzeigen',
  'depop', 'mercari', 'wallapop', 'etsy',
] as const;

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && (PLATFORM_IDS as readonly string[]).includes(value);
}

/** Absolute path to `<repo>/data/` — created on first use. */
export function resolveDataRoot(): string {
  const fromEnv = process.env.VINTED_DATA_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  // shared/src/accounts.ts → ../../data
  return path.resolve(__dirname, '..', '..', 'data');
}

/** `<data>/accounts/<id>/` — created on first use. */
export function accountDir(accountId: number): string {
  const dir = path.join(resolveDataRoot(), 'accounts', String(accountId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Playwright persistent-context storage dir for an account. */
export function accountBrowserDir(accountId: number): string {
  return accountDir(accountId);
}

/** Where shipping labels for this account get downloaded. */
export function accountLabelsDir(accountId: number): string {
  const dir = path.join(accountDir(accountId), 'labels');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** List all accounts — ordered newest-first for the account switcher. */
export function listAccounts(): VintedAccount[] {
  return getDb()
    .prepare('SELECT * FROM vinted_accounts ORDER BY id ASC')
    .all() as VintedAccount[];
}

export function listActiveAccounts(): VintedAccount[] {
  return getDb()
    .prepare('SELECT * FROM vinted_accounts WHERE active = 1 ORDER BY id ASC')
    .all() as VintedAccount[];
}

/** All active accounts for a given marketplace identity (Vinted/eBay/…).
 *
 * The `vinted_accounts.marketplace` column scopes which platform the
 * identity belongs to. Vinted-workers must call this instead of
 * `listActiveAccounts()` so they don't pick up eBay/KA identities and
 * try to drive a Vinted-bot with them. */
export function listActiveAccountsFor(marketplace: PlatformId): VintedAccount[] {
  return getDb()
    .prepare(
      `SELECT * FROM vinted_accounts
        WHERE active = 1 AND marketplace = ?
        ORDER BY id ASC`,
    )
    .all(marketplace) as VintedAccount[];
}

/** All accounts (active or not) for a marketplace — used by management UIs
 *  and metrics dashboards that want to show inactive identities too. */
export function listAccountsFor(marketplace: PlatformId): VintedAccount[] {
  return getDb()
    .prepare(
      `SELECT * FROM vinted_accounts
        WHERE marketplace = ?
        ORDER BY id ASC`,
    )
    .all(marketplace) as VintedAccount[];
}

export function getAccount(id: number): VintedAccount | null {
  return (getDb()
    .prepare('SELECT * FROM vinted_accounts WHERE id = ?')
    .get(id) as VintedAccount | undefined) ?? null;
}

export function requireAccount(id: number): VintedAccount {
  const a = getAccount(id);
  if (!a) throw new Error(`Unknown account id ${id}`);
  return a;
}

/**
 * Create a new account. Throws if the label is already taken.
 * The per-account folder is created eagerly so login can drop state files in.
 *
 * Back-compat: defaults to `marketplace = 'vinted'`. New code that wants
 * to spawn an eBay/KA/Depop identity should call `createAccountFor()`.
 */
export function createAccount(label: string): VintedAccount {
  return createAccountFor(label, 'vinted');
}

/**
 * Create a new account for a specific marketplace identity (Vinted, eBay,
 * Kleinanzeigen, …). The (label) UNIQUE constraint on `vinted_accounts`
 * stays — labels must be globally unique across platforms so the UI can
 * disambiguate "Alex" → it's recommended to prefix the platform in the
 * label (e.g. "Alex-Vinted" / "Alex-eBay-DE") which the create-dialog
 * suggests by default.
 */
export function createAccountFor(label: string, marketplace: PlatformId): VintedAccount {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Account-Label darf nicht leer sein');
  if (!isPlatformId(marketplace)) {
    throw new Error(`Unbekanntes Marketplace "${marketplace}"`);
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM vinted_accounts WHERE label = ?').get(trimmed);
  if (existing) throw new Error(`Account "${trimmed}" existiert schon`);

  // Reserve the id by inserting with placeholder paths — then fill them in.
  const info = db
    .prepare(
      `INSERT INTO vinted_accounts (label, state_path, data_dir, active, marketplace)
       VALUES (?, '', '', 1, ?)`,
    )
    .run(trimmed, marketplace);
  const id = info.lastInsertRowid as number;

  const dir = accountDir(id);
  const statePath = path.join(dir, 'state.json');

  db.prepare(
    `UPDATE vinted_accounts SET state_path = ?, data_dir = ? WHERE id = ?`,
  ).run(statePath, dir, id);

  return requireAccount(id);
}

export function renameAccount(id: number, newLabel: string): void {
  const trimmed = newLabel.trim();
  if (!trimmed) throw new Error('Label darf nicht leer sein');
  getDb()
    .prepare('UPDATE vinted_accounts SET label = ? WHERE id = ?')
    .run(trimmed, id);
}

export function setAccountActive(id: number, active: boolean): void {
  getDb()
    .prepare('UPDATE vinted_accounts SET active = ? WHERE id = ?')
    .run(active ? 1 : 0, id);
}

export function markAccountLoggedIn(id: number, username: string | null): void {
  getDb()
    .prepare(
      `UPDATE vinted_accounts
          SET logged_in = 1,
              last_login_at = datetime('now'),
              username = COALESCE(?, username)
        WHERE id = ?`,
    )
    .run(username, id);
}

export function markAccountLoggedOut(id: number): void {
  getDb()
    .prepare('UPDATE vinted_accounts SET logged_in = 0 WHERE id = ?').run(id);
}

/**
 * Hard-delete an account AND its folder. Cascades via FK to every scoped
 * table (listings, chats, auto_listings, …).
 * Refuses to delete the last remaining account — the system needs at
 * least one to function.
 */
export function deleteAccount(id: number): void {
  const all = listAccounts();
  if (all.length <= 1) throw new Error('Mindestens ein Account muss bleiben');
  const acc = requireAccount(id);
  getDb().prepare('DELETE FROM vinted_accounts WHERE id = ?').run(id);
  // Remove the browser profile folder — irreversible, user already confirmed.
  try {
    fs.rmSync(acc.data_dir, { recursive: true, force: true });
  } catch (err) {
    // Best-effort — log but don't throw.
    // eslint-disable-next-line no-console
    console.warn('Failed to remove account folder', acc.data_dir, err);
  }
}

/** The "currently selected" account id — stored in settings, default 1.
 *
 * When a marketplace is given, returns the currently selected account
 * **for that platform** (stored under `current_account_id_<marketplace>`).
 * The dashboard's per-platform views call this so switching the active
 * eBay-account doesn't clobber the active Vinted-account selection. If
 * no per-platform selection exists yet, falls back to any account that
 * belongs to that platform (first match) or to the global current id. */
export function getCurrentAccountId(marketplace?: PlatformId): number {
  const db = getDb();
  if (marketplace) {
    const key = `current_account_id_${marketplace}`;
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    if (row) {
      const parsed = Number.parseInt(row.value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        // Defensively confirm the stored id still belongs to this
        // marketplace — otherwise fall through to the fallback below.
        const acc = getAccount(parsed);
        if (acc && acc.marketplace === marketplace) return parsed;
      }
    }
    // Fallback: first account that belongs to this marketplace.
    const first = db
      .prepare(
        `SELECT id FROM vinted_accounts WHERE marketplace = ? ORDER BY id ASC LIMIT 1`,
      )
      .get(marketplace) as { id: number } | undefined;
    if (first) return first.id;
    // No account exists for this platform yet — return the global current.
  }
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'current_account_id'")
    .get() as { value: string } | undefined;
  const parsed = row ? Number.parseInt(row.value, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Persist the "currently selected" account id.
 *
 * Always writes the global `current_account_id` so callers without a
 * marketplace continue to work. When the account's own `marketplace`
 * column is known, ALSO writes the per-platform key so per-platform
 * views can stay in sync independently. */
export function setCurrentAccountId(id: number): void {
  const acc = requireAccount(id); // throws if id unknown
  const db = getDb();
  db.prepare(
    "INSERT INTO settings(key, value) VALUES ('current_account_id', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(String(id));
  // Mirror into the per-platform slot too so getCurrentAccountId(mp) finds it.
  const mp = acc.marketplace ?? 'vinted';
  if (isPlatformId(mp)) {
    db.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(`current_account_id_${mp}`, String(id));
  }
}

// ── Account warming ─────────────────────────────────────────────────────────
// Vinted bans new accounts that suddenly post 30+ listings/day. Real users
// drift in over weeks. We ramp the daily-publish cap linearly from
// `cap_min` (day 0) to `cap_base` (day 30+) so a fresh account starts at
// ~3 listings/day and grows to the full cap after one month.

/** Age of an account in calendar days since created_at. Returns 9999 for
 * the seeded Haupt-Account (id=1) so legacy single-account setups bypass
 * warming entirely. */
export function accountAgeDays(accountId: number): number {
  if (accountId === 1) {
    // Special-case: the bootstrap account is treated as "mature" so existing
    // single-account installs don't suddenly throttle themselves to 3/day
    // after this migration ships. New accounts (id ≥ 2) warm up normally.
    return 9999;
  }
  const row = getDb()
    .prepare(`SELECT julianday('now') - julianday(created_at) AS age FROM vinted_accounts WHERE id = ?`)
    .get(accountId) as { age: number | null } | undefined;
  if (!row?.age || !Number.isFinite(row.age)) return 0;
  return Math.max(0, Math.floor(row.age));
}

/** Default daily-publish cap per marketplace identity. Used when no
 *  `<marketplace>_daily_publish_cap` setting is configured. eBay
 *  allows ~100 listings/day per account, Vinted ~30, others vary. */
const DEFAULT_PUBLISH_CAP: Record<PlatformId, number> = {
  vinted: 30,
  ebay_de: 100,
  ebay_uk: 100,
  kleinanzeigen: 50,
  depop: 50,
  mercari: 50,
  wallapop: 50,
  etsy: 50,
};

const DEFAULT_PUBLISH_CAP_MIN: Record<PlatformId, number> = {
  vinted: 3,
  ebay_de: 10,
  ebay_uk: 10,
  kleinanzeigen: 5,
  depop: 5,
  mercari: 5,
  wallapop: 5,
  etsy: 5,
};

/** Resolved daily-publish cap for an account, accounting for warming.
 *
 * Formula:  cap = cap_min + (cap_base - cap_min) * min(age_days / 30, 1)
 *
 * Setting-key prefix depends on the account's marketplace column:
 *   'vinted'        → vinted_daily_publish_cap[_min] / vinted_warming_enabled
 *   'ebay_de'/'_uk' → ebay_daily_publish_cap[_min]   / ebay_warming_enabled
 *   other           → <marketplace>_daily_publish_cap[_min] / <marketplace>_warming_enabled
 *
 * eBay collapses both locales into a single `ebay_*` key family because the
 * platform's policy is shared across markets. Warming can be disabled per
 * platform with `<prefix>_warming_enabled = false`. */
export function accountDailyCap(accountId: number): number {
  const db = getDb();
  const acc = getAccount(accountId);
  const marketplace = (acc?.marketplace ?? 'vinted') as PlatformId;
  const prefix = settingPrefixFor(marketplace);

  const get = (k: string): string | null =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null;

  const defaultBase = DEFAULT_PUBLISH_CAP[marketplace] ?? 30;
  const base = Number(get(`${prefix}_daily_publish_cap`) ?? String(defaultBase));
  if (!Number.isFinite(base) || base <= 0) return defaultBase;

  if (get(`${prefix}_warming_enabled`) === 'false') return base;

  const defaultMin = DEFAULT_PUBLISH_CAP_MIN[marketplace] ?? 3;
  const min = Number(get(`${prefix}_daily_publish_cap_min`) ?? String(defaultMin));
  const floor = Number.isFinite(min) && min >= 0 ? min : defaultMin;

  const age = accountAgeDays(accountId);
  const ramp = Math.min(age / 30, 1);
  return Math.max(floor, Math.round(floor + (base - floor) * ramp));
}

/** Setting-key prefix for per-marketplace caps. Collapses eBay-locales
 *  into a single `ebay` family so the user configures the cap once. */
function settingPrefixFor(marketplace: PlatformId): string {
  if (marketplace === 'ebay_de' || marketplace === 'ebay_uk') return 'ebay';
  return marketplace;
}
