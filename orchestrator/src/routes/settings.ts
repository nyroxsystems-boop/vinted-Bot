import { Router } from 'express';
import { getDb, setSetting } from '@vinted-system/shared';
import { eventBus } from '../events.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as
    | { key: string; value: string }[];
  const obj: Record<string, string> = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

settingsRouter.patch('/', (req, res) => {
  const updates = req.body as Record<string, string | number | boolean>;
  for (const [k, v] of Object.entries(updates)) {
    const str = String(v);
    setSetting(k, str);
    eventBus.publish({ type: 'settings.updated', key: k, value: str });
  }
  res.json({ ok: true });
});
