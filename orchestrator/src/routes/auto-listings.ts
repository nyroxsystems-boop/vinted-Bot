// ──────────────────────────────────────────────────────────────────────────────
// Auto-Listings REST routes — CRUD for listing drafts.
//
// GET    /api/auto-listings              → list all (optional ?status=draft)
// GET    /api/auto-listings/:id          → single listing
// PATCH  /api/auto-listings/:id          → update fields (title, price, …)
// POST   /api/auto-listings/:id/approve  → set status to 'approved'
// POST   /api/auto-listings/approve-all  → approve all drafts
// POST   /api/auto-listings/generate     → manually trigger listing generation
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  listAutoListings,
  getAutoListing,
  updateAutoListing,
  approveAutoListing,
  approveAllDrafts,
  generateListingsForReadyProducts,
} from '../listing-generator.js';

export const autoListingsRouter = Router();

autoListingsRouter.get('/', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    res.json(listAutoListings(status));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

autoListingsRouter.get('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const listing = getAutoListing(id);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    res.json(listing);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

autoListingsRouter.patch('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const allowed = ['title', 'description', 'price_eur', 'size', 'condition', 'color', 'status'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updateAutoListing(id, updates as any);
    res.json({ ok: true, listing: getAutoListing(id) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

autoListingsRouter.post('/:id/approve', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    approveAutoListing(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

autoListingsRouter.post('/approve-all', (_req, res) => {
  try {
    const count = approveAllDrafts();
    res.json({ ok: true, approved: count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

autoListingsRouter.post('/generate', async (_req, res) => {
  try {
    const result = await generateListingsForReadyProducts();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
