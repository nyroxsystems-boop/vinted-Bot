import express, { type Request, type Response } from 'express';
import { createLogger, startBotRun, finishBotRun, getDb } from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { vintedQueue } from './queue.js';
import { pollVintedInbox } from './chats/poll.js';
import { acceptOffer } from './offers/accept.js';
import { declineOffer } from './offers/decline.js';
import { pollSaleStatuses } from './sales/track.js';

const log = createLogger('vinted-api');

export function createVintedApi(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/status', (_req: Request, res: Response) => {
    res.json({ bot: 'vinted', queue: vintedQueue.stats() });
  });

  app.post('/circuit-breaker/reset', (_req, res) => {
    vintedQueue.resetCircuitBreaker();
    res.json({ ok: true });
  });

  // Trigger one poll cycle for inbox messages + offer detection.
  app.post('/poll/inbox', async (_req, res) => {
    const runId = startBotRun('vinted', 'poll_inbox');
    try {
      const result = await vintedQueue.enqueue(
        () => pollVintedInbox(),
        'poll_inbox',
      );
      finishBotRun(runId, 'success');
      res.json({ ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // Trigger one poll cycle for sale status updates.
  app.post('/poll/sales', async (_req, res) => {
    const runId = startBotRun('vinted', 'poll_sales');
    try {
      const result = await vintedQueue.enqueue(
        () => pollSaleStatuses(),
        'poll_sales',
      );
      finishBotRun(runId, 'success');
      res.json({ ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // Accept an offer by id (called by orchestrator for auto or manual decisions).
  app.post('/offers/:id/accept', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const decidedBy = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
    const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
    if (!offer) return res.status(404).json({ ok: false, error: 'Offer not found' });

    const runId = startBotRun('vinted', 'accept_offer');
    try {
      const result = await vintedQueue.enqueue(
        () => acceptOffer(offer, decidedBy),
        `accept_offer_${id}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/offers/:id/decline', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const decidedBy = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
    const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
    if (!offer) return res.status(404).json({ ok: false, error: 'Offer not found' });

    const runId = startBotRun('vinted', 'decline_offer');
    try {
      const result = await vintedQueue.enqueue(
        () => declineOffer(offer, decidedBy),
        `decline_offer_${id}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
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
