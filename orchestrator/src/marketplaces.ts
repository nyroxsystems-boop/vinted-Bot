// ──────────────────────────────────────────────────────────────────────────────
// Multi-Marketplace Push-Hub
//
// Spricht mit den Bot-HTTP-Servern (vinted :4701, kleinanzeigen :4703,
// mercari :4704, depop :4705). Push-API:
//
//   POST /api/products/push-multi
//   { folderNum, marketplaces: ['vinted','kleinanzeigen', ...], accountId }
//
// Liest listing.json aus dem Folder, ruft pro Marktplatz den jeweiligen
// Adapter via HTTP, schreibt Ergebnis nach marketplace_listings.
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import {
  createLogger,
  getDb,
  isSold,
  vintedRoot,
  type ListingDraft,
  type MarketplaceId,
  type PublishResult,
} from '@vinted-system/shared';

const log = createLogger('marketplaces');

const VINTED_ROOT = vintedRoot();

export const BOT_ENDPOINTS: Record<string, string> = {
  vinted:        process.env.VINTED_BOT_URL        ?? 'http://localhost:4701',
  kleinanzeigen: process.env.KLEINANZEIGEN_BOT_URL ?? 'http://localhost:4703',
  mercari:       process.env.MERCARI_BOT_URL       ?? 'http://localhost:4704',
  depop:         process.env.DEPOP_BOT_URL         ?? 'http://localhost:4705',
  wallapop:      process.env.WALLAPOP_BOT_URL      ?? 'http://localhost:4706',
  ebay_de:       process.env.EBAY_DE_BOT_URL       ?? 'http://localhost:4707',
  ebay_uk:       process.env.EBAY_UK_BOT_URL       ?? 'http://localhost:4708',
  etsy:          process.env.ETSY_BOT_URL           ?? 'http://localhost:4709',
  grailed:       process.env.GRAILED_BOT_URL        ?? 'http://localhost:4710',
  fb_marketplace:process.env.FB_MARKETPLACE_BOT_URL ?? 'http://localhost:4711',
  // ── NEW: Tier 1 + Enterprise ───────────────────────────────────────────
  vestiaire:     process.env.VESTIAIRE_BOT_URL      ?? 'http://localhost:4712',
  whatnot:       process.env.WHATNOT_BOT_URL         ?? 'http://localhost:4713',
  poshmark:      process.env.POSHMARK_BOT_URL        ?? 'http://localhost:4719',
  shopify:       process.env.SHOPIFY_BOT_URL         ?? 'http://localhost:4717',
  woocommerce:   process.env.WOOCOMMERCE_BOT_URL     ?? 'http://localhost:4718',
  // ── NEW: EU Champions ──────────────────────────────────────────────────
  leboncoin:     process.env.LEBONCOIN_BOT_URL       ?? 'http://localhost:4714',
  marktplaats:   process.env.MARKTPLAATS_BOT_URL     ?? 'http://localhost:4715',
  willhaben:     process.env.WILLHABEN_BOT_URL       ?? 'http://localhost:4716',
  subito:        process.env.SUBITO_BOT_URL          ?? 'http://localhost:4717',
  ricardo:       process.env.RICARDO_BOT_URL         ?? 'http://localhost:4718',
};

interface DashboardListingFile {
  title: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  colors: string[];
  material: string;
  price_eur: number;
  shipping: string;
  photos: string[];
  status?: string;
}

function readListingFile(folderNum: number): DashboardListingFile | null {
  const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
  const fp = path.join(VINTED_ROOT, folderName, 'listing.json');
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}

function toDraft(folderNum: number, file: DashboardListingFile): ListingDraft {
  return {
    folderNum,
    title: file.title,
    description: file.description,
    category: file.category,
    brand: file.brand,
    size: file.size,
    condition: file.condition,
    colors: file.colors ?? [],
    material: file.material,
    priceEur: file.price_eur,
    shipping: file.shipping,
    photos: file.photos ?? [],
  };
}

async function publishOnPlatform(
  marketplace: MarketplaceId,
  accountId: number,
  draft: ListingDraft,
): Promise<PublishResult> {
  const url = `${BOT_ENDPOINTS[marketplace]}/api/listings/publish`;
  try {
    // 5 Min hard timeout pro Bot — Playwright kann long-running sein
    // (Photo-Upload, dynamische Felder), aber unbegrenzt warten ist nie OK.
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, draft }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: `bot ${marketplace} HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    return (await r.json()) as PublishResult;
  } catch (err) {
    return { ok: false, error: `bot ${marketplace} unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface MultiPushResult {
  folderNum: number;
  blocked?: 'sold';
  results: Array<{
    marketplace: MarketplaceId;
    publish: PublishResult;
    listingId?: number;
  }>;
}

/**
 * Async-Variant: returnt SOFORT mit Status 'publishing' für jede Plattform,
 * triggered Push im Hintergrund, schreibt Endergebnis (active|failed) in
 * marketplace_listings sobald jeweiliger Bot fertig ist.
 *
 * Dashboard pollt /api/products/:n/marketplace-listings für Live-Status.
 */
export async function pushToMarketplaces(opts: {
  folderNum: number;
  marketplaces: MarketplaceId[];
  accountId?: number;
}): Promise<MultiPushResult> {
  const accountId = opts.accountId ?? 1;
  const results: MultiPushResult['results'] = [];

  if (isSold(opts.folderNum)) {
    log.warn('Folder is locked (already sold)', { folderNum: opts.folderNum });
    return { folderNum: opts.folderNum, blocked: 'sold', results };
  }

  const file = readListingFile(opts.folderNum);
  if (!file) throw new Error(`listing.json not found for folder ${opts.folderNum}`);
  const draft = toDraft(opts.folderNum, file);

  const upsert = getDb().prepare(
    `INSERT INTO marketplace_listings
       (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(marketplace, account_id, folder_num) DO UPDATE SET
       external_id = COALESCE(excluded.external_id, marketplace_listings.external_id),
       external_url = COALESCE(excluded.external_url, marketplace_listings.external_url),
       status = excluded.status,
       list_price_eur = excluded.list_price_eur,
       last_error = excluded.last_error,
       updated_at = datetime('now')
     RETURNING id`,
  );

  // 1. Sofort 'publishing' setzen für alle gewählten Plattformen
  for (const mp of opts.marketplaces) {
    const row = upsert.get(mp, accountId, opts.folderNum, null, null, 'publishing', draft.priceEur, null) as { id: number } | undefined;
    results.push({
      marketplace: mp,
      publish: { ok: false, error: 'publishing in background…' },
      listingId: row?.id,
    });
  }

  // 2. Push im Hintergrund — Result-Update in DB, dashboard pollt
  for (const mp of opts.marketplaces) {
    void publishOnPlatform(mp, accountId, draft).then((publish) => {
      const status = publish.ok ? 'active' : 'failed';
      upsert.run(
        mp,
        accountId,
        opts.folderNum,
        publish.externalId ?? null,
        publish.externalUrl ?? null,
        status,
        draft.priceEur,
        publish.error ?? null,
      );
      log.info('Push background-task done', { folderNum: opts.folderNum, marketplace: mp, ok: publish.ok });
    }).catch((err) => {
      log.error('Push background-task crashed', {
        folderNum: opts.folderNum, marketplace: mp,
        err: err instanceof Error ? err.message : String(err),
      });
      upsert.run(
        mp, accountId, opts.folderNum, null, null, 'failed', draft.priceEur,
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  // 3. Sofort returnen — dashboard sieht 'publishing' und pollt
  return { folderNum: opts.folderNum, results };
}

/** Cross-Platform-Sync: nach Sale auf Plattform A → deaktiviert auf B,C,... */
export async function syncSoldToOthers(opts: {
  folderNum: number;
  soldOn: MarketplaceId;
  others: Array<{ marketplace: MarketplaceId; account_id: number; external_id: string | null; external_url: string | null }>;
}): Promise<Array<{ marketplace: MarketplaceId; ok: boolean; error?: string }>> {
  const results: Array<{ marketplace: MarketplaceId; ok: boolean; error?: string }> = [];
  for (const o of opts.others) {
    if (!o.external_id && !o.external_url) {
      results.push({ marketplace: o.marketplace, ok: false, error: 'no external_id/url' });
      continue;
    }
    const url = `${BOT_ENDPOINTS[o.marketplace]}/api/listings/deactivate`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account_id: o.account_id,
          external_id: o.external_id ?? o.external_url,
        }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      results.push({ marketplace: o.marketplace, ok: !!j.ok, error: j.error });
    } catch (err) {
      results.push({ marketplace: o.marketplace, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  log.info('Cross-platform deactivate done', { folderNum: opts.folderNum, soldOn: opts.soldOn, results });
  return results;
}
