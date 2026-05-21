// ──────────────────────────────────────────────────────────────────────────────
// Sales routes — dashboard-side manual operations.
//
//   GET  /api/sales/pending-ka  — KA-Chats flagged as possibly-sold by the
//                                 LLM detector, awaiting manual confirmation.
//   POST /api/sales/confirm-ka  — user confirms a KA-Sale → materialize
//                                 sale + listings row + lockSold.
//   POST /api/sales/reject-ka   — user dismisses a presumed-sold KA-Chat.
//   GET  /api/sales/stuck       — sales with paid_at set but no CJ-Order
//                                 after 2h (broken pipeline).
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getDb, lockSold, validateBuyerAddress, isPlatformId } from '@vinted-system/shared';
import { eventBus } from '../events.js';

const log = createLogger('routes:sales');
export const salesRouter = Router();

interface ManualSaleBody {
  marketplace: string;
  // Either reference an existing listing in our DB...
  listing_id?: number;
  // ...or describe the sale free-form (we'll synthesize a listings row)
  title?: string;
  list_price_eur?: number;
  account_id?: number;
  external_id?: string;        // platform-side ID if known (eBay orderId, KA convId, etc.)
  external_url?: string;       // platform-side URL
  // Buyer info — at minimum name + address required for CJ-fulfillment.
  buyer_name: string;
  buyer_address: {
    name?: string;
    street?: string;
    zip?: string;
    city?: string;
    country?: string;
    phone?: string;
  };
  buyer_phone?: string;
  // Optional context
  paid_at?: string;            // ISO-string; defaults to now()
  notes?: string;
}

/**
 * POST /api/sales/manual
 *
 * Create a Sale row out-of-band — for orders that came in while the platform-
 * scraper was offline, or arrived through a channel the system doesn't track
 * (direct eBay buys, WhatsApp deals, etc.). Either reference an existing
 * `listing_id` or pass `title` + `list_price_eur` to spin up a synthetic
 * listings row.
 */
salesRouter.post('/manual', async (req, res) => {
  try {
    const body = req.body as Partial<ManualSaleBody>;
    if (!body.marketplace || !isPlatformId(body.marketplace)) {
      return res.status(400).json({ ok: false, error: `marketplace required (one of: vinted, ebay_de, ebay_uk, kleinanzeigen, depop, mercari, wallapop, etsy)` });
    }
    if (!body.buyer_name?.trim()) {
      return res.status(400).json({ ok: false, error: 'buyer_name required' });
    }
    if (!body.buyer_address) {
      return res.status(400).json({ ok: false, error: 'buyer_address required (CJ needs it)' });
    }
    const addrErr = validateBuyerAddress(body.buyer_address);
    if (addrErr) return res.status(400).json({ ok: false, error: `Invalid address: ${addrErr}` });

    const db = getDb();

    // ── 1. Locate or synthesize the listings row ──────────────────────────
    let listingId: number;
    let listPrice: number;
    let folderNum: number | null = null;

    // Try to derive folder_num from the existing listing → marketplace_listings
    // link. Without folderNum the lockSold step below is a no-op and cross-
    // platform listings stay active → double-sell. This bug was real
    // (audit Finding #2).
    const resolveFolderNum = (vintedItemId: string | null, externalId: string | null): number | null => {
      if (vintedItemId) {
        const r = db.prepare(`
          SELECT folder_num FROM marketplace_listings
           WHERE external_id = CAST(? AS TEXT)
           LIMIT 1
        `).get(vintedItemId) as { folder_num: number } | undefined;
        if (r) return r.folder_num;
      }
      if (externalId) {
        const r = db.prepare(`
          SELECT folder_num FROM marketplace_listings
           WHERE external_id = ? AND marketplace = ?
           LIMIT 1
        `).get(externalId, body.marketplace) as { folder_num: number } | undefined;
        if (r) return r.folder_num;
      }
      return null;
    };

    if (body.listing_id) {
      const row = db.prepare(`
        SELECT id, list_price_eur, vinted_item_id FROM listings WHERE id = ?
      `).get(body.listing_id) as { id: number; list_price_eur: number; vinted_item_id: string | null } | undefined;
      if (!row) return res.status(404).json({ ok: false, error: `listing_id ${body.listing_id} not found` });
      listingId = row.id;
      listPrice = row.list_price_eur;
      folderNum = resolveFolderNum(row.vinted_item_id, body.external_id ?? null);
    } else {
      if (!body.title || typeof body.list_price_eur !== 'number') {
        return res.status(400).json({ ok: false, error: 'Either listing_id OR (title + list_price_eur) required' });
      }
      // Synthesize a listings row keyed by a stable synthetic URL so re-running
      // the same manual-sale doesn't duplicate. account_id defaults to 1.
      const accountId = body.account_id ?? 1;
      const syntheticUrl = body.external_url ?? `manual:${body.marketplace}:${body.external_id ?? Date.now()}`;
      const existing = db.prepare(`SELECT id FROM listings WHERE vinted_url = ?`).get(syntheticUrl) as { id: number } | undefined;
      if (existing) {
        listingId = existing.id;
      } else {
        const inserted = db.prepare(`
          INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
          VALUES (?, ?, ?, ?, ?, ?, 'sold')
          RETURNING id
        `).get(
          accountId,
          syntheticUrl,
          body.external_id ?? null,
          body.title,
          body.list_price_eur,
          Math.round(body.list_price_eur * 0.7 * 100) / 100,
        ) as { id: number };
        listingId = inserted.id;
      }
      listPrice = body.list_price_eur;
      // Synthesized listings have no vinted_item_id, so the only chance to
      // find a folder is via the user-supplied external_id matching a
      // marketplace_listings row for the same marketplace.
      folderNum = resolveFolderNum(null, body.external_id ?? null);
    }

    // ── 2. Insert sales row (idempotent: bail if a sale already exists for
    //       this listing+marketplace+buyer to prevent duplicate CJ orders)
    const dup = db.prepare(`
      SELECT id FROM sales WHERE listing_id = ? AND marketplace = ? AND buyer_name = ?
    `).get(listingId, body.marketplace, body.buyer_name) as { id: number } | undefined;
    if (dup) {
      return res.status(409).json({ ok: false, error: `Sale already exists (id=${dup.id})`, sale_id: dup.id });
    }

    const addrJson = JSON.stringify({ ...body.buyer_address, country: body.buyer_address.country ?? 'DE' });
    const inserted = db.prepare(`
      INSERT INTO sales (listing_id, buyer_name, buyer_address, buyer_phone, buyer_country, marketplace, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
      RETURNING id
    `).get(
      listingId,
      body.buyer_name,
      addrJson,
      body.buyer_phone ?? body.buyer_address.phone ?? null,
      body.buyer_address.country ?? 'DE',
      body.marketplace,
      body.paid_at ?? null,
    ) as { id: number };
    const saleId = inserted.id;

    // ── 3. Best-effort lockSold across other platforms ────────────────────
    if (folderNum !== null) {
      try { lockSold(folderNum, body.marketplace as Parameters<typeof lockSold>[1], listPrice, `manual:sale:${saleId}`); }
      catch { /* non-fatal */ }
    }

    log.info('Manual sale created', { saleId, marketplace: body.marketplace, listingId, buyer: body.buyer_name });
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `📝 Manueller Sale #${saleId} (${body.marketplace}): ${body.buyer_name}${body.notes ? ` — ${body.notes}` : ''}`,
    });

    // CJ auto-fulfillment kicks in on the next cj-fulfillment tick IF the
    // listing is linked to a cj_products row (folder_num → variant). For
    // truly manual sales without that linkage, the user has to place the CJ
    // order from CJ's own UI using the buyer_address we just stored.
    res.json({ ok: true, sale_id: saleId, listing_id: listingId });
  } catch (e) {
    log.error('manual sale failed', { error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** KA-chats with recent activity that are NOT yet marked as sold. */
salesRouter.get('/pending-ka', (_req, res) => {
  const rows = getDb().prepare(`
    SELECT c.id AS chat_id,
           c.buyer_username,
           c.ad_title,
           c.ad_url,
           c.last_message_at,
           (SELECT body FROM kleinanzeigen_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
           ml.folder_num,
           ml.list_price_eur
      FROM kleinanzeigen_chats c
 LEFT JOIN marketplace_listings ml ON ml.marketplace='kleinanzeigen' AND ml.external_url = c.ad_url
     WHERE c.last_message_at > datetime('now', '-14 days')
       AND NOT EXISTS (
         SELECT 1 FROM sales s
           JOIN listings l ON l.id = s.listing_id
          WHERE s.marketplace = 'kleinanzeigen'
            AND l.vinted_url = c.ad_url
       )
     ORDER BY c.last_message_at DESC
     LIMIT 100
  `).all();
  res.json({ ok: true, chats: rows, count: rows.length });
});

/** Confirm a KA-sale manually. Body: { chat_id, buyer_address?: BuyerAddress } */
salesRouter.post('/confirm-ka', (req, res) => {
  try {
    const { chat_id, buyer_address } = req.body as {
      chat_id: number;
      buyer_address?: { name?: string; street?: string; city?: string; zip?: string; country?: string; phone?: string };
    };
    if (!chat_id) return res.status(400).json({ ok: false, error: 'chat_id required' });

    const db = getDb();
    const chat = db.prepare(`
      SELECT id, buyer_username, ad_title, ad_url FROM kleinanzeigen_chats WHERE id = ?
    `).get(chat_id) as { id: number; buyer_username: string; ad_title: string | null; ad_url: string | null } | undefined;
    if (!chat) return res.status(404).json({ ok: false, error: 'chat not found' });

    if (buyer_address) {
      const err = validateBuyerAddress(buyer_address);
      if (err) return res.status(400).json({ ok: false, error: `Invalid address: ${err}` });
    }

    const ml = db.prepare(`
      SELECT folder_num, external_id, account_id, list_price_eur
        FROM marketplace_listings
       WHERE marketplace='kleinanzeigen' AND external_url = ?
       LIMIT 1
    `).get(chat.ad_url ?? '') as { folder_num: number; external_id: string; account_id: number; list_price_eur: number } | undefined;
    if (!ml) return res.status(404).json({ ok: false, error: 'No KA marketplace_listings for this ad — listing not crosslisted yet?' });

    // Idempotency: refuse double-confirm so a duplicate-click in the
    // dashboard doesn't create two sales (= two CJ orders billed). Audit #17.
    const synthUrl = chat.ad_url ?? `ka_${ml.external_id}`;
    const existingSale = db.prepare(`
      SELECT s.id FROM sales s
        JOIN listings l ON l.id = s.listing_id
       WHERE s.marketplace = 'kleinanzeigen' AND l.vinted_url = ?
       LIMIT 1
    `).get(synthUrl) as { id: number } | undefined;
    if (existingSale) {
      log.info('KA-Sale already confirmed — returning existing', { sale_id: existingSale.id, chat_id });
      return res.status(200).json({ ok: true, sale_id: existingSale.id, already_confirmed: true });
    }

    const tx = db.transaction(() => {
      let lst = db.prepare(`SELECT id FROM listings WHERE vinted_url = ?`).get(chat.ad_url ?? `ka_${ml.external_id}`) as { id: number } | undefined;
      if (!lst) {
        lst = db.prepare(`
          INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, status)
          VALUES (?, ?, ?, ?, ?, ?, 'sold')
          RETURNING id
        `).get(
          ml.account_id,
          chat.ad_url ?? `ka_${ml.external_id}`,
          ml.external_id,
          chat.ad_title ?? 'Kleinanzeigen Sale',
          ml.list_price_eur,
          Math.round(ml.list_price_eur * 0.75 * 100) / 100,
        ) as { id: number };
      }
      const sale = db.prepare(`
        INSERT INTO sales (listing_id, buyer_name, buyer_address, buyer_phone, buyer_country, marketplace, paid_at)
        VALUES (?, ?, ?, ?, ?, 'kleinanzeigen', datetime('now'))
        RETURNING id
      `).get(
        lst!.id,
        buyer_address?.name ?? chat.buyer_username,
        buyer_address ? JSON.stringify({ ...buyer_address, country: buyer_address.country ?? 'DE' }) : null,
        buyer_address?.phone ?? null,
        buyer_address?.country ?? 'DE',
      ) as { id: number };
      return { sale_id: sale.id, folder_num: ml.folder_num, listing_id: lst!.id };
    });
    const out = tx();
    try { lockSold(out.folder_num, 'kleinanzeigen', ml.list_price_eur, `manual:chat:${chat_id}`); } catch { /* non-fatal */ }

    log.info('KA-Sale manually confirmed', out);
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `✅ KA-Sale manuell bestätigt: "${chat.ad_title ?? '?'}" → Sale #${out.sale_id}. CJ-Order folgt.`,
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** Mark a KA-chat as definitively NOT-a-sale (dashboard dismiss). */
salesRouter.post('/reject-ka', (req, res) => {
  try {
    const { chat_id } = req.body as { chat_id: number };
    if (!chat_id) return res.status(400).json({ ok: false, error: 'chat_id required' });
    // Throttle the scanner: 30-day skip-marker.
    getDb()
      .prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES (?, datetime('now', '+30 days'))`)
      .run(`ka_chat_last_scan_${chat_id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** Stuck sales: paid_at set but no cj_order and >2h elapsed. */
salesRouter.get('/stuck', (_req, res) => {
  const rows = getDb().prepare(`
    SELECT s.id AS sale_id, s.paid_at, s.marketplace, s.buyer_name,
           l.title, l.vinted_url, l.vinted_item_id
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
     WHERE s.paid_at IS NOT NULL
       AND s.paid_at < datetime('now', '-2 hours')
       AND s.id NOT IN (SELECT sale_id FROM cj_orders)
     ORDER BY s.paid_at ASC
     LIMIT 50
  `).all();
  res.json({ ok: true, stuck: rows, count: rows.length });
});
