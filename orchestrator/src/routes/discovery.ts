// Routes für die Auto-Discovery Pipeline (Dashboard ⇄ Orchestrator)
//
//   GET  /api/discovery/stats   → counts (queued/imported/skipped/failed) + last-run
//   GET  /api/discovery/queue   → recent rows from cj_discovery_queue (latest 50)
//   GET  /api/discovery/runs    → recent cj_discovery_runs (latest 10)
//   POST /api/discovery/run-now → trigger one tick synchronously
//   POST /api/discovery/queue/:id/import-now → escalate to top-of-queue
//   POST /api/discovery/queue/:id/skip → mark skipped

import { Router } from 'express';
import {
  getDb,
  listFoldersForAccount,
  listUnassignedFolders,
  reassignFoldersFromAccount,
  setFolderAssignment,
} from '@vinted-system/shared';
import { runCjDiscoveryOnce } from '../cj-discovery.js';

export const discoveryRouter = Router();

discoveryRouter.get('/stats', (_req, res) => {
  const db = getDb();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM cj_discovery_queue GROUP BY status
  `).all() as Array<{ status: string; n: number }>;
  const lastRun = db.prepare(`
    SELECT id, raw_found, imported, skipped, errors, started_at, ended_at
      FROM cj_discovery_runs ORDER BY id DESC LIMIT 1
  `).get();
  const lastImport = db.prepare(`
    SELECT cj_product_id, title, score, updated_at
      FROM cj_discovery_queue WHERE status = 'imported'
      ORDER BY updated_at DESC LIMIT 1
  `).get();
  res.json({
    counts: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    last_run: lastRun ?? null,
    last_import: lastImport ?? null,
  });
});

discoveryRouter.get('/queue', (req, res) => {
  const status = (req.query.status as string | undefined) ?? null;
  const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10)));
  const rows = status
    ? getDb().prepare(`
        SELECT id, cj_product_id, cj_sku, title, category_path, cost_eur, image_url,
               source_query, score, status, skip_reason, last_error, crawled_product_id,
               discovered_at, updated_at
          FROM cj_discovery_queue WHERE status = ?
          ORDER BY discovered_at DESC LIMIT ?
      `).all(status, limit)
    : getDb().prepare(`
        SELECT id, cj_product_id, cj_sku, title, category_path, cost_eur, image_url,
               source_query, score, status, skip_reason, last_error, crawled_product_id,
               discovered_at, updated_at
          FROM cj_discovery_queue ORDER BY discovered_at DESC LIMIT ?
      `).all(limit);
  res.json({ items: rows });
});

discoveryRouter.get('/runs', (_req, res) => {
  const rows = getDb().prepare(`
    SELECT id, raw_found, imported, skipped, errors, started_at, ended_at
      FROM cj_discovery_runs ORDER BY id DESC LIMIT 10
  `).all();
  res.json({ runs: rows });
});

discoveryRouter.post('/run-now', async (_req, res) => {
  try {
    const r = await runCjDiscoveryOnce();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

discoveryRouter.post('/queue/:id/skip', (req, res) => {
  try {
    const id = parseInt(req.params.id ?? '', 10);
    getDb().prepare(
      `UPDATE cj_discovery_queue SET status = 'skipped', skip_reason = 'manual', updated_at = datetime('now') WHERE id = ?`,
    ).run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

discoveryRouter.post('/queue/:id/requeue', (req, res) => {
  try {
    const id = parseInt(req.params.id ?? '', 10);
    getDb().prepare(
      `UPDATE cj_discovery_queue SET status = 'queued', skip_reason = NULL, last_error = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Folder-Assignment routes ────────────────────────────────────────────────
// Multi-account ownership of crawled_products folders. Each folder is owned
// by exactly ONE Vinted account so the same product never gets listed by
// multiple accounts (Vinted bans duplicate listings). Discovery assigns
// round-robin on import; these endpoints let the dashboard inspect and
// manually re-balance the distribution.

/** GET /api/discovery/assignments?account_id=X[&status=ready]
 *  Returns folders currently owned by an account. */
discoveryRouter.get('/assignments', (req, res) => {
  try {
    const accountId = parseInt((req.query.account_id as string) ?? '', 10);
    if (!Number.isFinite(accountId) || accountId <= 0) {
      return res.status(400).json({ ok: false, error: 'account_id required' });
    }
    const status = (req.query.status as string | undefined) || undefined;
    const folders = listFoldersForAccount(accountId, status);
    res.json({ account_id: accountId, count: folders.length, folders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** GET /api/discovery/unassigned[?limit=N]
 *  Returns folders with no owner — candidates for the next round-robin pick
 *  or for manual assignment via /reassign. */
discoveryRouter.get('/unassigned', (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) ?? '200', 10)));
    const folders = listUnassignedFolders(limit);
    res.json({ count: folders.length, folders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/discovery/reassign  body: { folder_num, account_id|null }
 *  Manually move a folder to a specific account (or clear ownership when
 *  account_id is null, freeing it for the next round-robin pick). */
discoveryRouter.post('/reassign', (req, res) => {
  try {
    const folderNum = Number(req.body?.folder_num);
    const accountIdRaw = req.body?.account_id;
    if (!Number.isFinite(folderNum) || folderNum <= 0) {
      return res.status(400).json({ ok: false, error: 'folder_num required' });
    }
    const accountId =
      accountIdRaw === null || accountIdRaw === undefined ? null : Number(accountIdRaw);
    if (accountId !== null && (!Number.isFinite(accountId) || accountId <= 0)) {
      return res.status(400).json({ ok: false, error: 'account_id must be a positive int or null' });
    }
    const result = setFolderAssignment(folderNum, accountId);
    if (result === null && accountId !== null) {
      return res.status(404).json({ ok: false, error: 'folder not found' });
    }
    res.json({ ok: true, folder_num: folderNum, account_id: accountId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/discovery/rebalance  body: { from_account, to_account? }
 *  Bulk-move every non-final folder owned by from_account onto to_account
 *  (or to NULL when to_account is omitted — they re-enter the round-robin
 *  pool). Used when deactivating an account so its work doesn't sit idle. */
discoveryRouter.post('/rebalance', (req, res) => {
  try {
    const from = Number(req.body?.from_account);
    if (!Number.isFinite(from) || from <= 0) {
      return res.status(400).json({ ok: false, error: 'from_account required' });
    }
    const toRaw = req.body?.to_account;
    const to = toRaw === undefined || toRaw === null ? null : Number(toRaw);
    if (to !== null && (!Number.isFinite(to) || to <= 0)) {
      return res.status(400).json({ ok: false, error: 'to_account must be a positive int' });
    }
    const moved = reassignFoldersFromAccount(from, to);
    res.json({ ok: true, from_account: from, to_account: to, moved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
