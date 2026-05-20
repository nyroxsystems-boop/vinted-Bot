// ──────────────────────────────────────────────────────────────────────────────
// Vinted Trend Routes
//
//   GET  /api/trends                 → listLatestTrends (filterable by type)
//   GET  /api/trends/unused          → listUnusedTrends (cooldown-aware)
//   POST /api/trends/scrape-now      → fire the trend worker manually
//   POST /api/trends/:id/mark-used   → debug: bump last_used_at on one row
//
// Used by the dashboard's Trends-page to surface what we're scraping and to
// let the operator manually trigger a re-scrape when the DOM-best-guess
// selectors break and a new pass needs to happen NOW.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  listLatestTrends,
  listUnusedTrends,
  markTrendUsed,
  type TrendType,
} from '@vinted-system/shared';
import { runVintedTrendOnce } from '../vinted-trend-worker.js';

export const trendsRouter = Router();

function parseType(raw: unknown): TrendType | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'search' || raw === 'brand' || raw === 'category' || raw === 'hashtag') return raw;
  return undefined;
}

trendsRouter.get('/', (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10)));
    const type = parseType(req.query.type);
    const sinceHours = req.query.sinceHours ? Number(req.query.sinceHours) : undefined;
    const minRank = req.query.minRank ? Number(req.query.minRank) : undefined;
    const trends = listLatestTrends({
      limit,
      type,
      sinceHours: Number.isFinite(sinceHours) ? sinceHours : undefined,
      minRank: Number.isFinite(minRank) ? minRank : undefined,
    });
    res.json({ ok: true, count: trends.length, trends });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

trendsRouter.get('/unused', (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));
    const type = parseType(req.query.type);
    const cooldownHours = req.query.cooldownHours ? Number(req.query.cooldownHours) : 24;
    const trends = listUnusedTrends({
      limit,
      type,
      cooldownHours: Number.isFinite(cooldownHours) ? cooldownHours : 24,
    });
    res.json({ ok: true, count: trends.length, trends });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

trendsRouter.post('/scrape-now', async (_req, res) => {
  try {
    const r = await runVintedTrendOnce();
    res.status(r.ok ? 200 : 409).json(r);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

trendsRouter.post('/:id/mark-used', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }
    markTrendUsed(id, 0);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
