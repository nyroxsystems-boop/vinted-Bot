import { Router } from 'express';
import { getDb } from '@vinted-system/shared';

export const analyticsRouter = Router();

/**
 * GET /api/analytics/daily?days=30
 * Returns per-day KPIs for the last N days:
 *   { date, offers, accepted, paid, revenue_eur }
 */
analyticsRouter.get('/daily', (req, res) => {
  const days = Math.max(1, Math.min(365, Number.parseInt(String(req.query.days ?? '30'), 10)));
  const rows = getDb()
    .prepare(
      `WITH days(day) AS (
         SELECT date('now', ?)
         UNION ALL
         SELECT date(day, '+1 day') FROM days WHERE day < date('now')
       )
       SELECT d.day                                         AS date,
              COALESCE((SELECT COUNT(*) FROM offers o
                         WHERE date(o.created_at) = d.day), 0) AS offers,
              COALESCE((SELECT COUNT(*) FROM offers o
                         WHERE date(o.decided_at) = d.day
                           AND o.state = 'accepted'), 0)        AS accepted,
              COALESCE((SELECT COUNT(*) FROM sales s
                         WHERE date(s.paid_at) = d.day), 0)     AS paid,
              COALESCE((SELECT SUM(o.amount_eur) FROM offers o
                         JOIN sales s ON s.offer_id = o.id
                         WHERE date(s.paid_at) = d.day
                           AND o.state = 'accepted'), 0)        AS revenue_eur
         FROM days d
        ORDER BY d.day ASC`,
    )
    .all(`-${days - 1} days`);
  res.json(rows);
});

/**
 * GET /api/analytics/top-listings?limit=10&days=30
 * Returns best-selling listings by paid-sale count in the last N days.
 */
analyticsRouter.get('/top-listings', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit ?? '10'), 10)));
  const days = Math.max(1, Math.min(365, Number.parseInt(String(req.query.days ?? '30'), 10)));
  const rows = getDb()
    .prepare(
      `SELECT l.id,
              l.title,
              l.list_price_eur,
              COUNT(s.id)         AS sales_count,
              SUM(o.amount_eur)   AS revenue_eur
         FROM listings l
         JOIN sales    s ON s.listing_id = l.id
         LEFT JOIN offers o ON o.id = s.offer_id
        WHERE s.paid_at IS NOT NULL
          AND s.paid_at > datetime('now', ?)
        GROUP BY l.id
        ORDER BY sales_count DESC, revenue_eur DESC
        LIMIT ?`,
    )
    .all(`-${days} days`, limit);
  res.json(rows);
});

/**
 * GET /api/analytics/funnel?days=30
 * Returns conversion funnel: offers → accepted → paid → fulfilled
 */
analyticsRouter.get('/funnel', (req, res) => {
  const days = Math.max(1, Math.min(365, Number.parseInt(String(req.query.days ?? '30'), 10)));
  const cutoff = `-${days} days`;
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM offers WHERE created_at > datetime('now', ?)) AS offers,
         (SELECT COUNT(*) FROM offers WHERE created_at > datetime('now', ?) AND state = 'accepted') AS accepted,
         (SELECT COUNT(*) FROM sales  WHERE paid_at    > datetime('now', ?)) AS paid,
         (SELECT COUNT(*) FROM temu_orders WHERE placed_at > datetime('now', ?) AND state IN ('placed','shipped','delivered')) AS fulfilled`,
    )
    .get(cutoff, cutoff, cutoff, cutoff);
  res.json(row);
});
