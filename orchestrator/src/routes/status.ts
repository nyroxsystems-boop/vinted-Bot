import { Router } from 'express';
import { getDb, getSetting, recentWorkerEvents } from '@vinted-system/shared';
import { vintedClient } from '../bot-clients/vinted.js';

export const statusRouter = Router();

/** Configuration health-check — surface what's missing so the UI can show
 *  a banner instead of letting the user discover silent failures later.
 *  Returns one entry per capability with `ok: true|false` and a short reason. */
statusRouter.get('/config', (_req, res) => {
  const hasGemini    = !!(process.env.GEMINI_API_KEY?.trim() ?? getSetting('gemini_api_key')?.trim());
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY?.trim() ?? getSetting('anthropic_api_key')?.trim());
  const hasOpenai    = !!(process.env.OPENAI_API_KEY?.trim() ?? getSetting('openai_api_key')?.trim());
  const hasLlm       = hasGemini || hasAnthropic || hasOpenai;
  const hasCj        = !!(process.env.CJ_API_KEY?.trim() ?? getSetting('cj_api_key')?.trim());
  const checks = [
    { id: 'llm',           ok: hasLlm,    severity: 'critical' as const, label: 'LLM API-Key',          hint: 'Variant-Generator + Sale-Detection brauchen Gemini, Claude oder OpenAI. Trag den Key in Einstellungen → Keys ein.' },
    { id: 'gemini',        ok: hasGemini, severity: 'info'     as const, label: 'Gemini',               hint: hasGemini ? 'aktiv' : 'Empfohlen — Free-Tier deckt ~250 Listings/Tag.' },
    { id: 'anthropic',     ok: hasAnthropic, severity: 'info'  as const, label: 'Anthropic Claude',     hint: hasAnthropic ? 'aktiv' : 'Optional — bessere Texte aber ~$0.01/Listing.' },
    { id: 'cj',            ok: hasCj,     severity: 'optional' as const, label: 'CJ Dropshipping',      hint: hasCj ? 'verbunden' : 'Nur nötig wenn du CJ als Fulfillment nutzt.' },
  ];
  // Aggregate ok-ness — true only when nothing critical is missing.
  const ok = checks.filter((c) => c.severity === 'critical').every((c) => c.ok);
  res.json({ ok, checks });
});

/** Recent worker events — warn/error from the silent-failure telemetry.
 *  Frontend polls this to show "X errors in the last 24h" badges. */
statusRouter.get('/events', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const minLevel = (req.query.min_level as 'info' | 'warn' | 'error' | undefined) ?? 'warn';
  res.json({ ok: true, events: recentWorkerEvents({ limit, minLevel }) });
});

statusRouter.get('/', async (_req, res) => {
  const vinted = await vintedClient.status().catch((e) => ({ error: String(e) }));

  const kpis = (getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM listings WHERE status = 'active')         AS active_listings,
         (SELECT COUNT(*) FROM offers WHERE state = 'pending')           AS pending_offers,
         (SELECT COUNT(*) FROM sales WHERE paid_at IS NOT NULL AND shipped_at IS NULL) AS pending_sales,
         (SELECT COUNT(*) FROM cj_orders WHERE status = 'ordered')       AS open_cj_orders,
         (SELECT COUNT(*) FROM cj_orders WHERE status = 'failed')        AS failed_cj_orders`,
    )
    .get()) as Record<string, number>;

  res.json({
    kpis,
    bots: { vinted },
  });
});

statusRouter.get('/runs', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM bot_runs ORDER BY started_at DESC LIMIT 100')
    .all();
  res.json(rows);
});

// ── Worker Health ──────────────────────────────────────────────────────────
// Returns the last successful tick for each worker + whether it's healthy.
// A worker is "healthy" if its last tick is within 2× its expected interval.
statusRouter.get('/workers/health', (_req, res) => {
  const workers = [
    { name: 'vinted', intervalS: 60 },
    { name: 'listing-watcher', intervalS: 30 },
    { name: 'auto-publisher', intervalS: 60 },
    { name: 'listing-refresher', intervalS: 14400 },
    { name: 'image-generator', intervalS: 60 },
    { name: 'performance-collector', intervalS: 86400 },
    { name: 'repricer', intervalS: 86400 },
    { name: 'reply-autopilot', intervalS: 300 },
    { name: 'sales-fulfillment', intervalS: 300 },
    { name: 'cj-fulfillment', intervalS: 1800 },
    { name: 'relister', intervalS: 1800 },
    { name: 'telegram-alerts', intervalS: 0 },  // event-driven
  ];

  const db = getDb();
  const results = workers.map(w => {
    // bot_runs has: id, bot, action, started_at, ended_at, outcome, error
    // (no 'status' column — use 'outcome' instead)
    const lastRun = db
      .prepare(
        `SELECT started_at, outcome FROM bot_runs
         WHERE bot = ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(w.name) as { started_at: string; outcome: string | null } | undefined;

    let healthy = false;
    let lastTickAgo: number | null = null;

    if (lastRun) {
      const elapsed = (Date.now() - new Date(lastRun.started_at).getTime()) / 1000;
      lastTickAgo = Math.round(elapsed);
      // Event-driven workers (intervalS=0) are always "healthy" if they ran at all
      healthy = w.intervalS === 0
        ? true
        : elapsed < w.intervalS * 2.5;
    }

    return {
      name: w.name,
      healthy,
      lastTick: lastRun?.started_at ?? null,
      lastTickAgoS: lastTickAgo,
      lastOutcome: lastRun?.outcome ?? 'never_ran',
      expectedIntervalS: w.intervalS,
    };
  });

  const healthyCount = results.filter(r => r.healthy).length;
  res.json({
    healthy: healthyCount,
    total: results.length,
    workers: results,
  });
});
