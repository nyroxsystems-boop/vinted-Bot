// Temu crawler removed — CJ products are sourced via /api/cj/search.
import { Router } from 'express';
export const crawlerRouter = Router();

crawlerRouter.all('*', (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Temu crawler removed. Use GET /api/cj/search?keyword=… instead.',
  });
});
