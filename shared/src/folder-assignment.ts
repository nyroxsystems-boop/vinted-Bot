// ──────────────────────────────────────────────────────────────────────────────
// Folder Assignment — Round-Robin
//
// In multi-account setups (e.g. 10 Vinted-Accounts), every CJ-discovered
// folder (= one crawled_products row = one product) must be owned by EXACTLY
// ONE account. Otherwise three accounts would list the same folder → Vinted
// flags it as duplicate-listing → ban.
//
// The schema column `crawled_products.assigned_account_id` carries the
// assignment (FK → vinted_accounts(id), ON DELETE SET NULL). NULL means
// "unassigned, any account can pick it up". Discovery assigns round-robin
// on import; the listing-watcher honours the assignment when materialising
// `auto_listings` rows.
//
// Round-robin strategy: pick the active account that currently OWNS the
// FEWEST `crawled_products` rows. This load-balances when accounts get
// deactivated (their work redistributes naturally over time) and avoids the
// classic counter-based race where two concurrent imports both increment
// from the same baseline.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';
import { listActiveAccountsFor, type PlatformId } from './accounts.js';

/** Pick the next account for a new folder via round-robin among active
 *  accounts of the given platform. Returns null when no active accounts
 *  exist (caller falls back to NULL assignment).
 *
 *  Load-balanced: picks the account with the FEWEST currently assigned
 *  `crawled_products` rows. Ties broken by ascending account-id (stable). */
export function pickNextAccountForFolder(
  platform: PlatformId = 'vinted',
): number | null {
  const accounts = listActiveAccountsFor(platform);
  if (accounts.length === 0) return null;

  const placeholders = accounts.map(() => '?').join(',');
  const row = getDb()
    .prepare(
      `SELECT va.id AS account_id,
              (SELECT COUNT(*) FROM crawled_products
                WHERE assigned_account_id = va.id) AS folder_count
         FROM vinted_accounts va
        WHERE va.id IN (${placeholders})
        ORDER BY folder_count ASC, va.id ASC
        LIMIT 1`,
    )
    .get(...accounts.map((a) => a.id)) as
    | { account_id: number; folder_count: number }
    | undefined;

  return row?.account_id ?? accounts[0]!.id;
}

/** Pick + assign in a single SQLite transaction so two concurrent discovery
 *  imports can't BOTH pick the same "fewest-folders" account and skew
 *  round-robin. Returns the assigned account-id or null if no active
 *  accounts exist for the platform.
 *
 *  Idempotent: if the row is already assigned (assigned_account_id IS NOT
 *  NULL), returns the existing assignment unchanged. */
export function assignFolderToAccount(
  crawledProductId: number,
  platform: PlatformId = 'vinted',
): number | null {
  const db = getDb();

  const tx = db.transaction((cpId: number, mp: PlatformId): number | null => {
    const existing = db
      .prepare(
        `SELECT assigned_account_id FROM crawled_products WHERE id = ?`,
      )
      .get(cpId) as { assigned_account_id: number | null } | undefined;

    if (!existing) return null;
    if (existing.assigned_account_id != null) return existing.assigned_account_id;

    const accId = pickNextAccountForFolder(mp);
    if (accId === null) return null;

    db.prepare(
      `UPDATE crawled_products SET assigned_account_id = ? WHERE id = ?`,
    ).run(accId, cpId);
    return accId;
  });

  return tx(crawledProductId, platform);
}

/** Bulk reassign — move every unsold/unarchived folder from one account to
 *  another (or to NULL = unassigned for fresh round-robin). Used when an
 *  account is deactivated/deleted and its work must be redistributed.
 *
 *  Returns the number of rows affected. */
export function reassignFoldersFromAccount(
  fromAccountId: number,
  toAccountId?: number | null,
): number {
  const db = getDb();
  const target = toAccountId === undefined ? null : toAccountId;
  const r = db
    .prepare(
      `UPDATE crawled_products
          SET assigned_account_id = ?
        WHERE assigned_account_id = ?
          AND status NOT IN ('archived','sold')`,
    )
    .run(target, fromAccountId);
  return r.changes;
}

/** List folders assigned to a specific account, optionally filtered by
 *  status. Most-recently-updated first so dashboards show fresh work. */
export function listFoldersForAccount(
  accountId: number,
  status?: string,
): Array<{ folder_num: number; status: string; title: string | null }> {
  const db = getDb();
  if (status) {
    return db
      .prepare(
        `SELECT folder_num, status, title
           FROM crawled_products
          WHERE assigned_account_id = ? AND status = ?
          ORDER BY updated_at DESC`,
      )
      .all(accountId, status) as Array<{
      folder_num: number;
      status: string;
      title: string | null;
    }>;
  }
  return db
    .prepare(
      `SELECT folder_num, status, title
         FROM crawled_products
        WHERE assigned_account_id = ?
        ORDER BY updated_at DESC`,
    )
    .all(accountId) as Array<{
    folder_num: number;
    status: string;
    title: string | null;
  }>;
}

/** Unassigned (assigned_account_id IS NULL) non-final folders — used by the
 *  backfill job and by the rebalance UI. */
export function listUnassignedFolders(
  limit = 200,
): Array<{ id: number; folder_num: number }> {
  return getDb()
    .prepare(
      `SELECT id, folder_num
         FROM crawled_products
        WHERE assigned_account_id IS NULL
          AND status NOT IN ('archived','sold')
        ORDER BY id ASC
        LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; folder_num: number }>;
}

/** Force a specific folder onto a specific account (manual re-assignment
 *  from the dashboard). Returns the new assignment or null if the row
 *  doesn't exist. Passing `accountId = null` clears the assignment so the
 *  next pick-round can claim it. */
export function setFolderAssignment(
  folderNum: number,
  accountId: number | null,
): number | null {
  const r = getDb()
    .prepare(
      `UPDATE crawled_products SET assigned_account_id = ? WHERE folder_num = ?`,
    )
    .run(accountId, folderNum);
  return r.changes > 0 ? accountId : null;
}
