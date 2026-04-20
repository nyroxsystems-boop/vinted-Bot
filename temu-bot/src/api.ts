import express, { type Request, type Response } from 'express';
import { createLogger, startBotRun, finishBotRun, isPaused } from '@vinted-system/shared';
import type { CrawlerFilters } from '@vinted-system/shared';
import { temuQueue } from './queue.js';
import { addBatchToCart, buildOpenBatch } from './order/cart.js';
import { pollTemuOrders } from './track/status.js';
import {
  startLogin,
  getLoginFlowStatus,
  isLoginInProgress,
  temuSession,
} from './login-flow.js';
import { runCrawl, loadPresets, listProducts, listRuns } from './crawler/search.js';

const log = createLogger('temu-api');

export function createTemuApi(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/status', (_req, res) => {
    res.json({
      bot: 'temu',
      queue: temuQueue.stats(),
      session: temuSession.snapshot(),
      login: getLoginFlowStatus(),
    });
  });

  // Login flow endpoints.
  app.post('/login/start', (_req, res) => {
    if (isLoginInProgress()) {
      return res.status(409).json({ ok: false, error: 'Login läuft bereits' });
    }
    startLogin().catch(() => {
      /* error captured in flow status */
    });
    res.json({ ok: true, status: getLoginFlowStatus() });
  });

  app.get('/login/status', (_req, res) => {
    res.json({ session: temuSession.snapshot(), login: getLoginFlowStatus() });
  });

  const rejectIfLogin = (res: Response): boolean => {
    if (isLoginInProgress()) {
      res.status(409).json({ ok: false, error: 'Login läuft — bitte warten' });
      return true;
    }
    return false;
  };

  // Auto-launch login when we detect an auth error — keeps the browser open
  // so the user can log in without clicking a button in the dashboard.
  const maybeAutoLogin = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not authenticated|login|session expired|unauthorized/i.test(msg)) {
      if (!isLoginInProgress()) {
        log.warn('Session invalid — auto-starting login flow');
        startLogin().catch(() => {
          /* captured in flow status */
        });
      }
    }
  };

  app.post('/circuit-breaker/reset', (_req, res) => {
    temuQueue.resetCircuitBreaker();
    res.json({ ok: true });
  });

  // ── Batch-cart endpoints ────────────────────────────────────────────────
  // POST /batches — create a new "open" batch collecting paid sales from
  //                 the last N hours that aren't already in a batch.
  //                 Body: { windowHours: number }
  app.post('/batches', (req: Request, res: Response) => {
    if (isPaused()) {
      return res.status(409).json({ ok: false, error: 'System is paused' });
    }
    const { windowHours } = req.body as { windowHours?: number };
    const w = Number.isFinite(windowHours) ? Math.max(1, Math.min(168, windowHours!)) : 24;
    try {
      const result = buildOpenBatch(w);
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /batches/:id/add — kick off the actual add-to-cart run for the
  //                         given batch. Blocks until all items processed.
  app.post('/batches/:id/add', async (req, res) => {
    if (isPaused()) {
      return res.status(409).json({ ok: false, error: 'System is paused' });
    }
    if (rejectIfLogin(res)) return;
    const batchId = Number.parseInt(req.params.id, 10);
    const runId = startBotRun('temu', 'add_batch_to_cart');
    try {
      const result = await temuQueue.enqueue(
        () => addBatchToCart({ batchId }),
        `add_batch_${batchId}`,
      );
      if (result.ok) temuSession.markValid();
      else if (result.error) maybeAutoLogin(new Error(result.error));
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      temuSession.handleError(err);
      maybeAutoLogin(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/poll/orders', async (_req, res) => {
    if (rejectIfLogin(res)) return;
    const runId = startBotRun('temu', 'poll_orders');
    try {
      const result = await temuQueue.enqueue(() => pollTemuOrders(), 'poll_orders');
      temuSession.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      temuSession.handleError(err);
      maybeAutoLogin(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Crawler endpoints ───────────────────────────────────────────────────

  app.get('/crawler/presets', async (_req, res) => {
    try {
      const data = await loadPresets();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/crawler/products', (req, res) => {
    const status = (req.query.status as string | undefined) || undefined;
    res.json(listProducts(status as any));
  });

  app.get('/crawler/runs', (_req, res) => {
    res.json(listRuns(20));
  });

  /**
   * POST /crawler/run
   * Body:
   *   { queries: string[], filters?: Partial<CrawlerFilters>, presetName?: string }
   * Blocking — returns CrawlResult[] when done. May run for minutes.
   */
  app.post('/crawler/run', async (req: Request, res: Response) => {
    if (isPaused()) return res.status(409).json({ ok: false, error: 'System paused' });
    if (rejectIfLogin(res)) return;

    const { queries, filters, presetName } = req.body as {
      queries?: string[];
      filters?: Partial<CrawlerFilters>;
      presetName?: string;
    };
    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({ ok: false, error: 'queries[] required' });
    }

    // Merge user filters with defaults.
    let defaults: CrawlerFilters = {
      min_rating: 4.2,
      min_reviews: 100,
      max_price_eur: 25,
      max_per_query: 100,
    };
    try {
      const presets = await loadPresets();
      defaults = { ...defaults, ...presets.default_filters };
    } catch {
      /* use hard-coded defaults */
    }
    const merged: CrawlerFilters = { ...defaults, ...(filters ?? {}) };

    const runId = startBotRun('temu', 'crawler_run');
    try {
      const results = await temuQueue.enqueue(
        () => runCrawl({ queries, filters: merged, presetName }),
        `crawler_${queries.length}q`,
      );
      temuSession.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, results, filters: merged });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      temuSession.handleError(err);
      maybeAutoLogin(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    log.error('Unhandled API error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}
