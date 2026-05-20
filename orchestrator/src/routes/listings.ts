import { Router, type Request, type Response } from 'express';
import { createLogger, getDb } from '@vinted-system/shared';
import type { Listing } from '@vinted-system/shared';

const log = createLogger('routes:listings');
export const listingsRouter = Router();

// ──────────────────────────────────────────────────────────────────────────────
// Massen-Start: alle auto_listings.status='draft' (oder gefilterte Subset)
// auf 'approved' setzen. Auto-Publisher picked sie dann mit 1/min cadence.
//
// POST /api/listings/start-batch
//   body: { folder_nums?: number[], min_margin_eur?: number, dry_run?: boolean }
//   - folder_nums: nur diese folders approve. Wenn weggelassen: alle drafts.
//   - min_margin_eur: nur drafts mit profit_margin_eur ≥ X (default 5)
//   - dry_run: returnt nur count, ohne update.
//
// Filter immer:
//   - status = 'draft'
//   - cj_variant_id NOT NULL (CJ-Mapping vorhanden)
//   - photo_paths_json hat ≥ 3 Photos
// ──────────────────────────────────────────────────────────────────────────────
// Whitelist for the marketplace param — must match `MarketplaceId` in shared
// and the keys in `BOT_ENDPOINTS`. Validation lives here so a typo from the
// client can't poison the auto_listings row.
const VALID_MARKETPLACES = new Set([
  'vinted', 'kleinanzeigen', 'mercari', 'depop', 'wallapop',
  'ebay_de', 'ebay_uk', 'etsy', 'grailed', 'fb_marketplace',
  'vestiaire', 'whatnot', 'poshmark', 'leboncoin', 'marktplaats', 'willhaben',
  'shopify', 'woocommerce',
]);

function sanitizeTargets(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = input
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.trim())
    .filter((s) => VALID_MARKETPLACES.has(s));
  return out.length > 0 ? Array.from(new Set(out)) : null;
}

listingsRouter.post('/start-batch', (req, res) => {
  try {
    const { folder_nums, min_margin_eur, dry_run, target_marketplaces } = req.body as {
      folder_nums?: number[];
      min_margin_eur?: number;
      dry_run?: boolean;
      target_marketplaces?: string[];
    };
    const minMargin = Number(min_margin_eur ?? 5);
    const targets = sanitizeTargets(target_marketplaces);
    const db = getDb();

    let where = `WHERE status = 'draft'
       AND cj_variant_id IS NOT NULL
       AND profit_margin_eur >= ?
       AND json_array_length(COALESCE(photo_paths_json, '[]')) >= 3`;
    const params: unknown[] = [minMargin];
    if (Array.isArray(folder_nums) && folder_nums.length > 0) {
      where += ` AND folder_num IN (${folder_nums.map(() => '?').join(',')})`;
      params.push(...folder_nums);
    }

    const candidates = db.prepare(`SELECT id, folder_num, title, price_eur, profit_margin_eur FROM auto_listings ${where} ORDER BY profit_margin_eur DESC`).all(...params);

    if (dry_run) {
      return res.json({ ok: true, dry_run: true, would_approve: candidates.length, listings: candidates, target_marketplaces: targets });
    }

    // Persist publish targets ON the row so the auto-publisher reads them
    // per-listing instead of relying on global settings. NULL targets leave
    // the existing target_marketplaces value untouched (legacy fallback).
    const updated = targets
      ? db.prepare(`UPDATE auto_listings SET status = 'approved', target_marketplaces = ?, updated_at = datetime('now') ${where}`)
          .run(JSON.stringify(targets), ...params)
      : db.prepare(`UPDATE auto_listings SET status = 'approved', updated_at = datetime('now') ${where}`)
          .run(...params);

    log.info(`Start-batch: ${updated.changes} drafts approved`, {
      filter_folder_count: folder_nums?.length ?? 'all',
      min_margin: minMargin,
      targets: targets ?? '(default)',
    });

    res.json({ ok: true, approved: updated.changes, listings: candidates.slice(0, 50), target_marketplaces: targets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Approve / un-approve individual draft.
listingsRouter.post('/:autoId/approve', (req, res) => {
  const id = Number(req.params.autoId);
  const r = getDb().prepare(`UPDATE auto_listings SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'draft'`).run(id);
  res.json({ ok: true, updated: r.changes });
});

listingsRouter.post('/:autoId/unapprove', (req, res) => {
  const id = Number(req.params.autoId);
  const r = getDb().prepare(`UPDATE auto_listings SET status = 'draft', updated_at = datetime('now') WHERE id = ? AND status = 'approved'`).run(id);
  res.json({ ok: true, updated: r.changes });
});

// Get/edit per-marketplace variants
listingsRouter.get('/:autoId/variants', (req, res) => {
  const id = Number(req.params.autoId);
  const rows = getDb().prepare(`
    SELECT marketplace, title, description, category, brand, size, condition, color, material, tags_json, generated_by, updated_at
      FROM auto_listing_variants WHERE auto_listing_id = ?
  `).all(id);
  res.json({ ok: true, variants: rows });
});

listingsRouter.put('/:autoId/variants/:marketplace', (req, res) => {
  try {
    const id = Number(req.params.autoId);
    const mp = String(req.params.marketplace);
    const b = req.body as { title?: string; description?: string; category?: string; brand?: string; size?: string; condition?: string; color?: string; material?: string; tags?: string[] };
    if (!b.title || !b.description) return res.status(400).json({ ok: false, error: 'title + description required' });
    getDb().prepare(`
      INSERT INTO auto_listing_variants (auto_listing_id, marketplace, title, description, category, brand, size, condition, color, material, tags_json, generated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
      ON CONFLICT(auto_listing_id, marketplace) DO UPDATE SET
        title = excluded.title, description = excluded.description,
        category = excluded.category, brand = excluded.brand, size = excluded.size,
        condition = excluded.condition, color = excluded.color, material = excluded.material,
        tags_json = excluded.tags_json, generated_by = 'manual', updated_at = datetime('now')
    `).run(id, mp, b.title, b.description, b.category ?? '', b.brand ?? 'Ohne Marke', b.size ?? 'S', b.condition ?? 'Neu', b.color ?? '', b.material ?? '', JSON.stringify(b.tags ?? []));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Force re-generate variant via LLM
listingsRouter.post('/:autoId/variants/:marketplace/regenerate', async (req, res) => {
  try {
    const id = Number(req.params.autoId);
    const mp = String(req.params.marketplace);
    if (mp !== 'vinted' && mp !== 'kleinanzeigen' && mp !== 'ebay_de') return res.status(400).json({ ok: false, error: 'marketplace must be vinted, kleinanzeigen or ebay_de' });
    const { generateVariantFor } = await import('../variant-generator.js');
    const ok = await generateVariantFor(id, mp);
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Bulk-Regenerate: deletes all existing variants for a marketplace so the
// variant-generator worker re-generates them on its next tick (within 5 min).
listingsRouter.post('/variants/regenerate-all', (req, res) => {
  try {
    const { marketplace, status_filter } = req.body as { marketplace: string; status_filter?: string };
    if (!['vinted', 'kleinanzeigen', 'ebay_de'].includes(marketplace)) {
      return res.status(400).json({ ok: false, error: 'marketplace must be vinted|kleinanzeigen|ebay_de' });
    }
    let sql = `DELETE FROM auto_listing_variants
                WHERE marketplace = ?
                  AND auto_listing_id IN (SELECT id FROM auto_listings WHERE cj_variant_id IS NOT NULL`;
    const params: unknown[] = [marketplace];
    if (status_filter) {
      sql += ` AND status = ?`;
      params.push(status_filter);
    }
    sql += `)`;
    const r = getDb().prepare(sql).run(...params);
    log.info(`Bulk-regenerate queued: ${r.changes} variants cleared`, { marketplace, status_filter });
    res.json({ ok: true, cleared: r.changes, message: 'Variants gelöscht — variant-generator regeneriert in <5min.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Stats: how many drafts vs approved vs published
listingsRouter.get('/stats', (_req, res) => {
  const stats = getDb().prepare(`
    SELECT status, COUNT(*) AS count, ROUND(AVG(profit_margin_eur), 2) AS avg_margin
      FROM auto_listings GROUP BY status
  `).all();
  const variants = getDb().prepare(`
    SELECT marketplace, COUNT(*) AS count FROM auto_listing_variants GROUP BY marketplace
  `).all();
  res.json({ ok: true, by_status: stats, variants_by_marketplace: variants });
});

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
