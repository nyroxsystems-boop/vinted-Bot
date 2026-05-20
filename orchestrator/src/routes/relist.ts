// ──────────────────────────────────────────────────────────────────────────────
// Re-Lister routes (dashboard-facing)
//
//   GET  /api/relist/queue       — folders sold, waiting for re-list
//   GET  /api/relist/history     — recent re-list events
//   GET  /api/relist/stats       — per-day counts, success rate
//   POST /api/relist/pause/:id   — mark a folder paused (no future re-list)
//   POST /api/relist/resume/:id  — un-pause
//   POST /api/relist/now/:id     — force-relist now (skip 24h delay)
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getDb, getSetting } from '@vinted-system/shared';

const log = createLogger('routes:relist');
export const relistRouter = Router();

// ── Queue: folders that have sold_at but no active clone yet ───────────────
relistRouter.get('/queue', (_req, res) => {
  const delayH = Number(getSetting('relist_delay_hours') ?? '24');
  const rows = getDb().prepare(`
    SELECT al.id, al.folder_num, al.title, al.price_eur, al.sold_at,
           al.relist_count,
           CAST(((julianday('now') - julianday(al.sold_at)) * 24) AS INTEGER) AS hours_since_sale,
           ${delayH} AS delay_hours_needed,
           CASE
             WHEN al.sold_at < datetime('now', '-${delayH} hours') THEN 'ready'
             ELSE 'waiting'
           END AS state
      FROM auto_listings al
     WHERE al.sold_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM auto_listings sib
          WHERE sib.folder_num = al.folder_num
            AND sib.id != al.id
            AND sib.sold_at IS NULL
            AND sib.status IN ('draft','approved','publishing','published')
       )
     ORDER BY al.sold_at DESC
  `).all();
  res.json({ ok: true, queue: rows, count: rows.length });
});

// ── History: most-recent re-list clones ─────────────────────────────────────
relistRouter.get('/history', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50)));
  const rows = getDb().prepare(`
    SELECT id, folder_num, title, status, price_eur,
           parent_folder_num, relist_count,
           created_at, updated_at, last_error
      FROM auto_listings
     WHERE parent_folder_num IS NOT NULL
     ORDER BY created_at DESC
     LIMIT ?
  `).all(limit);
  res.json({ ok: true, history: rows, count: rows.length });
});

// ── Stats: per-day counts, success rate ─────────────────────────────────────
relistRouter.get('/stats', (_req, res) => {
  const db = getDb();
  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM auto_listings WHERE parent_folder_num IS NOT NULL
                                            AND created_at > datetime('now','-24 hours'))             AS last_24h,
      (SELECT COUNT(*) FROM auto_listings WHERE parent_folder_num IS NOT NULL
                                            AND created_at > datetime('now','-7 days'))               AS last_7d,
      (SELECT COUNT(*) FROM auto_listings WHERE parent_folder_num IS NOT NULL
                                            AND status = 'published')                                 AS relists_published,
      (SELECT COUNT(*) FROM auto_listings WHERE parent_folder_num IS NOT NULL
                                            AND status = 'failed')                                    AS relists_failed,
      (SELECT MAX(relist_count) FROM auto_listings)                                                   AS max_relist_count
  `).get();
  const daily = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
      FROM auto_listings
     WHERE parent_folder_num IS NOT NULL
       AND created_at > datetime('now', '-30 days')
     GROUP BY day
     ORDER BY day DESC
  `).all();
  res.json({
    ok: true,
    summary,
    daily,
    settings: {
      enabled: getSetting('relist_enabled') === 'true',
      delay_hours: Number(getSetting('relist_delay_hours') ?? '24'),
      max_per_day: Number(getSetting('relist_max_per_day') ?? '30'),
      inactive_pause_days: Number(getSetting('relist_inactive_pause_days') ?? '21'),
    },
  });
});

// ── Pause / resume a folder ─────────────────────────────────────────────────
relistRouter.post('/pause/:folder', (req, res) => {
  try {
    const folder = Number(req.params.folder);
    if (!folder) return res.status(400).json({ ok: false, error: 'invalid folder' });
    // We piggy-back on last_sold_at being old enough to fall into the
    // inactive-pause window — but the cleanest pause is a dedicated marker.
    // Use a sentinel: set last_sold_at to 1970-01-01 (clearly outside any window).
    getDb()
      .prepare(`UPDATE auto_listings SET last_sold_at = '1970-01-01 00:00:00' WHERE folder_num = ?`)
      .run(folder);
    log.info('Folder re-list paused', { folder });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

relistRouter.post('/resume/:folder', (req, res) => {
  try {
    const folder = Number(req.params.folder);
    if (!folder) return res.status(400).json({ ok: false, error: 'invalid folder' });
    // Restore last_sold_at to sold_at so the re-lister picks it up again.
    getDb()
      .prepare(`UPDATE auto_listings SET last_sold_at = COALESCE(sold_at, datetime('now')) WHERE folder_num = ?`)
      .run(folder);
    log.info('Folder re-list resumed', { folder });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Force-relist now (skip 24h delay) ───────────────────────────────────────
relistRouter.post('/now/:folder', (req, res) => {
  try {
    const folder = Number(req.params.folder);
    if (!folder) return res.status(400).json({ ok: false, error: 'invalid folder' });
    // Shift sold_at backwards so it falls outside the delay window.
    const r = getDb()
      .prepare(`UPDATE auto_listings SET sold_at = datetime('now', '-25 hours')
                 WHERE folder_num = ? AND sold_at IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM auto_listings sib
                      WHERE sib.folder_num = auto_listings.folder_num
                        AND sib.id != auto_listings.id
                        AND sib.sold_at IS NULL
                        AND sib.status IN ('draft','approved','publishing','published')
                   )`)
      .run(folder);
    log.info('Folder re-list forced', { folder, updated: r.changes });
    res.json({ ok: true, updated: r.changes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
