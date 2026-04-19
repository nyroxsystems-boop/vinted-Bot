import { Router } from 'express';
import { getDb } from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { vintedClient } from '../bot-clients/vinted.js';
import { eventBus } from '../events.js';

export const offersRouter = Router();

offersRouter.get('/', (req, res) => {
  const state = (req.query.state as string | undefined) ?? 'pending';
  const rows = getDb()
    .prepare('SELECT * FROM offers WHERE state = ? ORDER BY created_at DESC')
    .all(state) as Offer[];
  res.json(rows);
});

// Link an offer to a listing (used when the bot couldn't auto-link).
offersRouter.patch('/:id/listing', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { listingId } = req.body as { listingId: number };
  getDb().prepare('UPDATE offers SET listing_id = ? WHERE id = ?').run(listingId, id);
  res.json({ ok: true });
});

offersRouter.post('/:id/accept', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const result = await vintedClient.acceptOffer(id, 'manual');
    if (result.ok) {
      const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer;
      eventBus.publish({ type: 'offer.decided', offer });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

offersRouter.post('/:id/decline', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const result = await vintedClient.declineOffer(id, 'manual');
    if (result.ok) {
      const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer;
      eventBus.publish({ type: 'offer.decided', offer });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
