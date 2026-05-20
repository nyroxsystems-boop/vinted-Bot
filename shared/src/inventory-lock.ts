// ──────────────────────────────────────────────────────────────────────────────
// Cross-Platform Inventory-Lock
//
// 1 physisches Item (= folder_num) → kann auf N Plattformen gleichzeitig live
// sein. Sobald irgendwo verkauft, sperrt der Lock alle anderen Bots.
//
// Bots prüfen vor jeder Aktion `isSold(folderNum)` und brechen ab wenn true.
// Beim Sold-Detect: `lockSold(folderNum, marketplace, price, buyerRef)` →
// gibt Liste aller anderen Marketplace-Listings zurück, die deaktiviert
// werden sollten (Aufruf des jeweiligen Adapter.deactivate()).
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';
import type { MarketplaceId } from './marketplace/types.js';

export interface InventoryLock {
  folder_num: number;
  is_sold: boolean;
  sold_on?: MarketplaceId;
  sold_price_eur?: number;
  sold_at?: string;
  buyer_ref?: string;
}

export function isSold(folderNum: number): boolean {
  const row = getDb()
    .prepare('SELECT is_sold FROM inventory_locks WHERE folder_num = ?')
    .get(folderNum) as { is_sold: number } | undefined;
  return row?.is_sold === 1;
}

export function getLock(folderNum: number): InventoryLock | null {
  const row = getDb()
    .prepare('SELECT * FROM inventory_locks WHERE folder_num = ?')
    .get(folderNum) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    folder_num: row.folder_num as number,
    is_sold: row.is_sold === 1,
    sold_on: row.sold_on as MarketplaceId | undefined,
    sold_price_eur: row.sold_price_eur as number | undefined,
    sold_at: row.sold_at as string | undefined,
    buyer_ref: row.buyer_ref as string | undefined,
  };
}

export interface OtherListing {
  id: number;
  marketplace: MarketplaceId;
  account_id: number;
  external_id: string | null;
  external_url: string | null;
}

/**
 * Markiert Folder als verkauft, gibt Liste der zu deaktivierenden Cross-Listings zurück.
 * Idempotent: doppelter Aufruf macht keinen Schaden, gibt aber ggf. leere Liste zurück.
 */
export function lockSold(
  folderNum: number,
  soldOn: MarketplaceId,
  priceEur: number,
  buyerRef?: string,
): OtherListing[] {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO inventory_locks (folder_num, is_sold, sold_on, sold_price_eur, sold_at, buyer_ref)
       VALUES (?, 1, ?, ?, datetime('now'), ?)
       ON CONFLICT(folder_num) DO UPDATE SET
         is_sold = 1,
         sold_on = COALESCE(sold_on, excluded.sold_on),
         sold_price_eur = COALESCE(sold_price_eur, excluded.sold_price_eur),
         sold_at = COALESCE(sold_at, excluded.sold_at),
         buyer_ref = COALESCE(buyer_ref, excluded.buyer_ref),
         updated_at = datetime('now')`,
    ).run(folderNum, soldOn, priceEur, buyerRef ?? null);

    // Markiere alle anderen Marktplatz-Listings als 'sold' (für Audit-Trail),
    // gib sie aber zurück als "deaktiviere mich noch live"-Liste.
    const others = db
      .prepare(
        `SELECT id, marketplace, account_id, external_id, external_url
           FROM marketplace_listings
          WHERE folder_num = ?
            AND marketplace != ?
            AND status NOT IN ('sold','deactivated')`,
      )
      .all(folderNum, soldOn) as Array<Record<string, unknown>>;

    db.prepare(
      `UPDATE marketplace_listings
          SET status = 'sold', updated_at = datetime('now')
        WHERE folder_num = ?
          AND marketplace = ?
          AND status NOT IN ('sold')`,
    ).run(folderNum, soldOn);

    return others.map((r) => ({
      id: r.id as number,
      marketplace: r.marketplace as MarketplaceId,
      account_id: r.account_id as number,
      external_id: (r.external_id as string | null) ?? null,
      external_url: (r.external_url as string | null) ?? null,
    }));
  });

  return tx();
}

/** Setzt den Lock zurück (z.B. wenn Sale rückgängig). */
export function clearLock(folderNum: number): void {
  getDb()
    .prepare('UPDATE inventory_locks SET is_sold = 0, updated_at = datetime(\'now\') WHERE folder_num = ?')
    .run(folderNum);
}
