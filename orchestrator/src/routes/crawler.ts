import { Router } from 'express';
import { temuClient } from '../bot-clients/temu.js';

export const crawlerRouter = Router();

crawlerRouter.get('/presets', async (_req, res) => {
  try {
    res.json(await temuClient.crawlerPresets());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

crawlerRouter.get('/products', async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    res.json(await temuClient.crawlerProducts(status));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

crawlerRouter.get('/runs', async (_req, res) => {
  try {
    res.json(await temuClient.crawlerRuns());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

crawlerRouter.post('/run', async (req, res) => {
  try {
    const body = req.body as {
      queries?: string[];
      filters?: Record<string, number>;
      presetName?: string;
    };
    if (!Array.isArray(body.queries) || body.queries.length === 0) {
      return res.status(400).json({ error: 'queries[] required' });
    }
    const result = await temuClient.crawlerRun({
      queries: body.queries,
      filters: body.filters as never,
      presetName: body.presetName,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
