import { Router, type Request, type Response } from 'express';
import { getDb } from '@vinted-system/shared';
import type { Listing } from '@vinted-system/shared';

export const listingsRouter = Router();

listingsRouter.get('/', (_req: Request, res: Response) => {
  const rows = getDb()
    .prepare('SELECT * FROM listings ORDER BY updated_at DESC')
    .all() as Listing[];
  res.json(hydrateList(rows));
});

listingsRouter.get('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const row = getDb().prepare('SELECT * FROM listings WHERE id = ?').get(id) as Listing | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(hydrate(row));
});

listingsRouter.post('/', (req, res) => {
  const b = req.body as Partial<Listing>;
  if (!b.vinted_url || !b.title || b.list_price_eur == null || b.min_accept_price_eur == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const res1 = getDb()
    .prepare(
      `INSERT INTO listings
         (vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur,
          temu_url, temu_variant, status, dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'active'), COALESCE(?, 0))`,
    )
    .run(
      b.vinted_url,
      b.vinted_item_id ?? null,
      b.title,
      b.list_price_eur,
      b.min_accept_price_eur,
      b.temu_url ?? null,
      b.temu_variant ? JSON.stringify(b.temu_variant) : null,
      b.status ?? 'active',
      b.dry_run ?? 0,
    );
  const row = getDb().prepare('SELECT * FROM listings WHERE id = ?').get(res1.lastInsertRowid) as Listing;
  res.status(201).json(hydrate(row));
});

listingsRouter.patch('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = getDb().prepare('SELECT * FROM listings WHERE id = ?').get(id) as Listing | undefined;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const b = req.body as Partial<Listing>;
  const merged: Listing = {
    ...existing,
    ...b,
    // temu_variant must be stringified for SQLite
    temu_variant: b.temu_variant
      ? (typeof b.temu_variant === 'string' ? JSON.parse(b.temu_variant) : b.temu_variant)
      : existing.temu_variant,
  };

  getDb()
    .prepare(
      `UPDATE listings SET
         vinted_url = ?, vinted_item_id = ?, title = ?,
         list_price_eur = ?, min_accept_price_eur = ?,
         temu_url = ?, temu_variant = ?, status = ?, dry_run = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      merged.vinted_url,
      merged.vinted_item_id,
      merged.title,
      merged.list_price_eur,
      merged.min_accept_price_eur,
      merged.temu_url,
      merged.temu_variant ? JSON.stringify(merged.temu_variant) : null,
      merged.status,
      merged.dry_run,
      id,
    );
  const row = getDb().prepare('SELECT * FROM listings WHERE id = ?').get(id) as Listing;
  res.json(hydrate(row));
});

listingsRouter.delete('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  // Soft-archive to preserve foreign-key chains to sales/orders.
  getDb().prepare("UPDATE listings SET status = 'archived' WHERE id = ?").run(id);
  res.status(204).end();
});

function hydrate(l: Listing): Listing {
  return {
    ...l,
    temu_variant: l.temu_variant
      ? (typeof l.temu_variant === 'string' ? JSON.parse(l.temu_variant) : l.temu_variant)
      : null,
  };
}
function hydrateList(xs: Listing[]): Listing[] {
  return xs.map(hydrate);
}
