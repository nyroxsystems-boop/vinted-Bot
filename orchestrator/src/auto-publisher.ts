// ──────────────────────────────────────────────────────────────────────────────
// Auto-Publisher — watches for auto_listings with status 'approved' and
// publishes them to Vinted via the vinted-bot's /listings/create endpoint.
//
// Runs on a configurable interval (default 60s) and processes ONE listing
// per cycle to avoid overwhelming the Vinted bot (which uses a single
// browser session).
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  getSetting,
  withLock,
  isPaused,
  listActiveAccountsFor,
  accountDailyCap,
} from '@vinted-system/shared';
import { vintedClient } from './bot-clients/vinted.js';
import { pushToMarketplaces, BOT_ENDPOINTS } from './marketplaces.js';
import { eventBus } from './events.js';
import { readVariant, generateVariantFor, type SupportedMarketplace } from './variant-generator.js';
import { transformPhotosFor } from './photo-transform.js';
import type { MarketplaceId } from '@vinted-system/shared';

// C3 — Variant-gen retry constants. Calls that fail (LLM-error, parse-fail,
// missing api-key) are queued for retry on the next publish cycle with a
// hard cap to prevent infinite retry loops on permanently-broken folders.
const VARIANT_GEN_TIMEOUT_MS = 30_000;
const MAX_VARIANT_GEN_RETRIES = 3;

const log = createLogger('auto-publisher');

let publisherTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 60_000; // 60 seconds — one listing per minute max

// One-shot inline migration for the variant-retry tracking columns. Same
// pattern as relister.ts:ensureSupersedeColumns — ALTER ADD COLUMN is a
// no-op once present, and we swallow "duplicate column" errors.
let retryColsEnsured = false;
function ensureRetryColumns(): void {
  if (retryColsEnsured) return;
  const db = getDb();
  const tryAdd = (table: string, col: string, defSQL: string): void => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSQL}`); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column/i.test(msg)) {
        log.debug('ensure-column skipped', { table, col, err: msg });
      }
    }
  };
  tryAdd('marketplace_listings', 'variant_retry_count', 'INTEGER NOT NULL DEFAULT 0');
  tryAdd('marketplace_listings', 'crosslist_retry_count', 'INTEGER NOT NULL DEFAULT 0');
  retryColsEnsured = true;
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;  // critical: respect manual pause
  isRunning = true;
  try {
    // Multi-account: each active account is its own publishing queue with
    // its own per-account daily-cap and warming curve. Locks are scoped
    // per account so one slow account doesn't block the others; one
    // listing per account per tick keeps Vinted's spam-detection happy.
    // Filter to Vinted-identities only — this publisher drives the
    // vinted-bot. eBay/KA/Depop identities have their own pipelines and
    // would crash here trying to call the Vinted publish endpoint.
    const accounts = listActiveAccountsFor('vinted');
    if (accounts.length === 0) {
      log.debug('No active Vinted accounts — auto-publisher idle');
      return;
    }
    for (const acc of accounts) {
      try {
        await withLock(`auto-publisher-tick:${acc.id}`, 300, () => publishNextApproved(acc.id));
      } catch (err) {
        log.error('Auto-publisher error for account', {
          account_id: acc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    isRunning = false;
  }
}

async function publishNextApproved(accountId: number): Promise<void> {
  // Recover stuck 'publishing' rows. Two failure modes:
  //   (a) the orchestrator crashed mid-publish → row sits on 'publishing'
  //   (b) the bot succeeded but our DB update failed → row sits on
  //       'publishing' even though Vinted already has the listing
  //
  // We can't distinguish (a) from (b) locally — the safest action is to
  // bump retry_count and reset to 'approved' only if retries are still
  // available. Beyond 3 retries we park the row at 'failed' with an
  // explicit reason so the user sees it instead of an infinite re-publish
  // loop that risks duplicate listings on Vinted.
  const stuckRows = getDb().prepare(`
    SELECT id, retry_count
      FROM auto_listings
     WHERE status = 'publishing'
       AND account_id = ?
       AND updated_at < datetime('now', '-15 minutes')
  `).all(accountId) as Array<{ id: number; retry_count: number }>;

  for (const r of stuckRows) {
    const next = (r.retry_count ?? 0) + 1;
    if (next >= 3) {
      getDb().prepare(`
        UPDATE auto_listings
           SET status = 'failed',
               retry_count = ?,
               last_error = COALESCE(last_error, 'Stuck on publishing >15min after 3 retries — manual check required'),
               updated_at = datetime('now')
         WHERE id = ?
      `).run(next, r.id);
      log.warn('stuck publishing parked at failed', { id: r.id, retries: next });
    } else {
      getDb().prepare(`
        UPDATE auto_listings
           SET status = 'approved',
               retry_count = ?,
               updated_at = datetime('now')
         WHERE id = ?
      `).run(next, r.id);
      log.info('stuck publishing reset to approved', { id: r.id, retries: next });
    }
  }

  // Vinted-Account-Bann-Schutz: Daily-Cap auf NEUE Listings, PRO ACCOUNT.
  // Vinted-Spam-Detection greift bei >50 frischen Listings/Tag/Account, deshalb
  // ist die Cap account-scoped — sonst würden 3 Accounts sich 30/Tag teilen.
  // `accountDailyCap()` zieht zusätzlich den Warming-Faktor ein (frischer
  // Account startet bei cap_min, rampt linear über 30 Tage auf cap_base).
  //
  // Race-safety: the cap-check + pick + status-flip all run inside
  // `withLock('auto-publisher-tick:<accountId>')`, which is a DB UNIQUE-
  // constraint lock (db-lock.ts). That guarantees serial execution per
  // account across processes — two orchestrators racing won't both pass the
  // cap check for the same account. Different accounts run in parallel.
  const dailyCap = accountDailyCap(accountId);
  const pickAndReserve = getDb().transaction(() => {
    const todayCount = (getDb().prepare(`
      SELECT COUNT(*) AS cnt FROM auto_listings
       WHERE status IN ('published','publishing')
         AND account_id = ?
         AND updated_at > datetime('now', '-24 hours')
    `).get(accountId) as { cnt: number }).cnt;
    if (todayCount >= dailyCap) return { capped: true, count: todayCount, row: null };

    const row = getDb()
      .prepare(`SELECT * FROM auto_listings WHERE status = 'approved' AND account_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(accountId) as Record<string, unknown> | undefined;
    if (!row) return { capped: false, count: todayCount, row: null };

    // Reserve immediately inside the same transaction so a second tick
    // (even on the same process — defence-in-depth) can't pick the same row.
    getDb()
      .prepare(`UPDATE auto_listings SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND status = 'approved'`)
      .run(row.id as number);
    return { capped: false, count: todayCount, row };
  });

  const picked = pickAndReserve();
  if (picked.capped) {
    log.debug(`Daily Vinted publish cap reached (account=${accountId}, ${picked.count}/${dailyCap}) — pausing`);
    return;
  }
  const row = picked.row;
  if (!row) return; // nothing to publish

  const id = row.id as number;
  const title = row.title as string;
  const description = row.description as string;
  const category = row.category as string;
  const brand = row.brand as string;
  const size = row.size as string;
  const condition = row.condition as string;
  const color = row.color as string;
  const material = (row.material as string) || undefined;
  const price = row.price_eur as number;
  const photoPaths: string[] = JSON.parse((row.photo_paths_json as string) || '[]');
  const folderNum = row.folder_num as number;
  const crawledProductId = row.crawled_product_id as number | null;

  // Pull the Temu source URL — needed so the purchase-queue view can show
  // the user what to buy. Stored on the auto_listings row itself (if the
  // listing-generator already filled it in) or looked up via the linked
  // crawled_product.
  let temuUrl = (row.temu_url as string | null) ?? '';
  if (!temuUrl && crawledProductId) {
    const cp = getDb()
      .prepare('SELECT temu_url FROM crawled_products WHERE id = ?')
      .get(crawledProductId) as { temu_url: string } | undefined;
    temuUrl = cp?.temu_url ?? '';
  }
  if (!temuUrl) {
    const cp = getDb()
      .prepare('SELECT temu_url FROM crawled_products WHERE folder_num = ?')
      .get(folderNum) as { temu_url: string } | undefined;
    temuUrl = cp?.temu_url ?? '';
  }

  if (photoPaths.length < 3) {
    log.warn('Skipping listing — insufficient photos', { id, folderNum, photos: photoPaths.length });
    getDb()
      .prepare(`UPDATE auto_listings SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run('Insufficient photos (< 3)', id);
    return;
  }

  // Defense-in-depth: even if status='approved' slipped through (shouldn't,
  // approveAutoListing gates this), block publish when photos are raw CJ
  // stock. Move row back to 'raw' so image-gen picks it up next.
  const hasGeneratedPhotos = photoPaths.some((p) =>
    /\/scene\/|\/final\/|\/generated\//.test(p),
  );
  if (!hasGeneratedPhotos) {
    log.warn('Skipping listing — only raw CJ photos', { id, folderNum });
    getDb()
      .prepare(`UPDATE auto_listings SET status = 'raw', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run('Raw CJ photos — model+scene+product render missing', id);
    return;
  }

  // Pre-flight: verify the photo files actually exist on disk. A listing with
  // a missing file would fail in Playwright with a confusing error.
  const fs = await import('node:fs');
  const missing = photoPaths.filter(p => !fs.existsSync(p));
  if (missing.length > 0) {
    const err = `Missing photo files: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ''}`;
    log.warn('Skipping listing — missing photo files', { id, folderNum, missing: missing.length });
    getDb()
      .prepare(`UPDATE auto_listings SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(err, id);
    eventBus.publish({
      type: 'alert',
      level: 'error',
      message: `❌ Listing "${title}" abgebrochen — ${missing.length} Foto-Files fehlen auf Disk.`,
    });
    return;
  }

  // Read the Vinted-specific variant (LLM-generated title/description/category).
  // Falls back to the master auto_listings row if no variant exists yet.
  // Vinted-master variant — generate on demand if missing OR if the cached
  // value still looks like the raw CJ import title. Without this we'd send
  // the raw "[Import] …" CJ title which Vinted's spam filter flags ("Über-
  // schrift enthält zu viele Sonderzeichen hintereinander") and the publish
  // hangs without success modal → 120s queue timeout.
  let vintedV = readVariant(id, 'vinted');
  const looksRaw = (t?: string): boolean =>
    !t || t.startsWith('[Import]') || /Kleider #\d+\s*—/.test(t);
  if (looksRaw(vintedV?.title)) {
    log.info('Generating vinted master variant on-demand', { id, folderNum });
    try {
      await generateVariantFor(id, 'vinted' as SupportedMarketplace);
      vintedV = readVariant(id, 'vinted');
    } catch (err) {
      log.warn('Vinted variant-gen failed — falling back to cleaned raw title', {
        folderNum, err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Clean raw title as last-resort fallback. Strip the "[Import] Kleider #N —"
  // prefix + collapse whitespace + cap at 80 chars (Vinted limit). Also
  // remove parenthesized colour suffixes like "(Light Blue Floral)" which
  // trip the special-character validator.
  const cleanedRaw = title
    .replace(/^\[Import\]\s*/, '')
    .replace(/^\w+\s*#\d+\s*—\s*/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const vintedTitle = (looksRaw(vintedV?.title) ? cleanedRaw : vintedV!.title)
    .slice(0, 80);
  const vintedDesc = vintedV?.description || description;
  const vintedCategory = vintedV?.category || category;
  const vintedBrand = vintedV?.brand || brand;
  const vintedSize = vintedV?.size || size;
  const vintedCondition = vintedV?.condition || condition;
  const vintedColor = vintedV?.color || color;
  const vintedMaterial = vintedV?.material || material;

  log.info('Publishing listing to Vinted', { id, folderNum, title: vintedTitle, price, hasVariant: !!vintedV });

  // Status was already flipped to 'publishing' inside pickAndReserve so
  // a parallel tick can't grab the same row. Re-running the UPDATE here is
  // redundant — keep as a no-op safety in case the function is called
  // standalone (e.g. via /api/home/publish-now without the picker).
  getDb()
    .prepare(`UPDATE auto_listings SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND status != 'publishing'`)
    .run(id);

  try {
    const result = await vintedClient.createListing({
      title: vintedTitle,
      description: vintedDesc,
      category: vintedCategory,
      brand: vintedBrand,
      size: vintedSize,
      condition: vintedCondition,
      color: vintedColor,
      material: vintedMaterial,
      price,
      photoPaths,
    });

    if (result.ok) {
      // Success! Update auto_listing + crawled_products
      getDb()
        .prepare(
          `UPDATE auto_listings
              SET status = 'published',
                  vinted_url = ?,
                  vinted_item_id = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(result.vintedUrl ?? null, result.vintedItemId ?? null, id);

      // Update crawled_product status to 'listed'
      getDb()
        .prepare(`UPDATE crawled_products SET status = 'listed', updated_at = datetime('now') WHERE folder_num = ?`)
        .run(folderNum);

      // Also create a proper listing row in the listings table
      // so the offer/sales pipeline can link to it.
      // min_accept_price: floor at 150% of CJ-cost, else 75% of list price
      // — whichever is higher, so we never sell below cost.
      const temuPrice = (row.temu_price_eur as number) ?? 0;
      const minAccept = Math.max(price * 0.75, temuPrice * 1.5);
      // accountId is the function parameter — row.account_id is guaranteed
      // to match because pickAndReserve filtered on it.
      // When the create-flow only returns a profile URL (item-id not
      // scraped), make it unique per auto-listing so the listings.vinted_url
      // UNIQUE constraint doesn't blow on the next publish.
      let vintedUrlForRow = result.vintedUrl ?? '';
      if (vintedUrlForRow.includes('/member/') && !result.vintedItemId) {
        vintedUrlForRow = `${vintedUrlForRow}#listing-${id}`;
      }
      // ON CONFLICT for re-publishes: Vinted occasionally returns the same
      // item-id for a re-listed product (e.g. when a duplicate is detected
      // server-side). Without the upsert, the second attempt crashes on
      // UNIQUE(vinted_url). Re-activate the existing row instead.
      getDb()
        .prepare(
          `INSERT INTO listings (account_id, vinted_url, vinted_item_id, title, list_price_eur, min_accept_price_eur, temu_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
           ON CONFLICT(vinted_url) DO UPDATE SET
             vinted_item_id       = excluded.vinted_item_id,
             title                = excluded.title,
             list_price_eur       = excluded.list_price_eur,
             min_accept_price_eur = excluded.min_accept_price_eur,
             temu_url             = excluded.temu_url,
             status               = 'active'`,
        )
        .run(
          accountId,
          vintedUrlForRow,
          result.vintedItemId ?? null,
          title,
          price,
          Math.round(minAccept * 100) / 100,
          temuUrl,
        );

      // Marketplace_listings: one row per external_id (so re-list adds a NEW
      // row instead of overwriting the old one). cj-fulfillment / cross-sync
      // join via external_id, which is unique now.
      if (result.vintedItemId) {
        getDb()
          .prepare(
            `INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
             VALUES ('vinted', ?, ?, ?, ?, 'active', ?)
             ON CONFLICT(marketplace, account_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
               external_url = excluded.external_url,
               status = 'active',
               list_price_eur = excluded.list_price_eur,
               last_error = NULL,
               updated_at = datetime('now')`,
          )
          .run(accountId, folderNum, String(result.vintedItemId), result.vintedUrl ?? '', price);
      }

      // Also persist temu_url back on the auto_listings row itself so the
      // purchase-queue and dashboard views don't need the join.
      if (temuUrl) {
        getDb()
          .prepare('UPDATE auto_listings SET temu_url = ? WHERE id = ?')
          .run(temuUrl, id);
      }

      log.info('Listing published successfully! 🎉', {
        id,
        folderNum,
        title,
        vintedUrl: result.vintedUrl,
      });

      eventBus.publish({
        type: 'alert',
        level: 'warn',
        message: `✅ Anzeige "${title}" für €${price.toFixed(2)} auf Vinted veröffentlicht!`,
      });

      // ── Auto-Crosslist to other marketplaces (Kleinanzeigen etc.) ───
      // Build the draft from the auto_listings row directly — no listing.json file
      // is needed because the row already has title/desc/photos/etc.
      //
      // Target resolution:
      //   1. Per-row `target_marketplaces` (set by the dashboard Publish-Picker)
      //      wins — explicit user intent, marketplace-by-marketplace.
      //   2. Legacy fallback: global `auto_crosslist_targets` setting + the
      //      `<mp>_enabled` toggles for KA / eBay-DE.
      let targets: string[] = [];
      const rowTargetsRaw = row.target_marketplaces as string | null;
      let rowTargets: string[] | null = null;
      if (rowTargetsRaw) {
        try {
          const arr = JSON.parse(rowTargetsRaw);
          if (Array.isArray(arr)) rowTargets = arr.filter((s): s is string => typeof s === 'string');
        } catch { /* ignore — fall through to legacy */ }
      }
      if (rowTargets && rowTargets.length > 0) {
        targets = rowTargets;
      } else {
        const crosslistTargets = getSetting('auto_crosslist_targets');
        const kaEnabled = getSetting('kleinanzeigen_enabled') === 'true';
        const ebayDeEnabled = getSetting('ebay_de_enabled') === 'true';
        try { targets = crosslistTargets ? JSON.parse(crosslistTargets) : []; } catch { /* ignore */ }
        if (kaEnabled && !targets.includes('kleinanzeigen')) targets.push('kleinanzeigen');
        if (ebayDeEnabled && !targets.includes('ebay_de')) targets.push('ebay_de');
      }
      const otherMarketplaces = targets.filter(
        (m): m is MarketplaceId => m !== 'vinted' && m.length > 0,
      );

      if (otherMarketplaces.length > 0) {
        ensureRetryColumns();
        let crossFails = 0;
        for (const mp of otherMarketplaces) {
          // ── C3: Variant-Gen with 30s timeout + retry-queue ─────────────
          // Read the marketplace-specific variant (LLM-generated). Per-mp
          // title/description/category/etc. If no variant yet, generate
          // synchronously so the crosslist always uses a tailored draft.
          let mpV = readVariant(id, mp);
          if (!mpV?.title || mpV.title === title) {
            log.info(`Generating ${mp} variant on-demand before crosslist`, { folder: folderNum });
            try {
              // 30s timeout per spec — LLM hang would otherwise stall the
              // entire publish-tick, blocking other accounts/folders.
              await Promise.race([
                generateVariantFor(id, mp as SupportedMarketplace),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('variant-gen timeout (30s)')), VARIANT_GEN_TIMEOUT_MS),
                ),
              ]);
              mpV = readVariant(id, mp);
            } catch (err) {
              log.warn(`Variant-gen for ${mp} failed`, {
                folder: folderNum, err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          // C3: If we still don't have a usable variant after on-demand gen,
          // write a marketplace_listings row with status='failed' so cross-
          // sync has a sync-anchor + a retry-queue row to revisit next tick.
          if (!mpV?.title) {
            const reason = 'Variant-gen failed (LLM error or timeout)';
            // Look up any existing failed row (NULL external_id) so we can
            // bump variant_retry_count and decide between retry / give-up.
            const existing = getDb().prepare(`
              SELECT id, COALESCE(variant_retry_count, 0) AS rc
                FROM marketplace_listings
               WHERE marketplace = ? AND account_id = ? AND folder_num = ? AND external_id IS NULL
               LIMIT 1
            `).get(mp, accountId, folderNum) as { id: number; rc: number } | undefined;

            const nextRc = (existing?.rc ?? 0) + 1;
            if (existing) {
              getDb().prepare(`
                UPDATE marketplace_listings
                   SET status = 'failed',
                       last_error = ?,
                       variant_retry_count = ?,
                       updated_at = datetime('now')
                 WHERE id = ?
              `).run(reason, nextRc, existing.id);
            } else {
              getDb().prepare(`
                INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur, last_error, variant_retry_count)
                VALUES (?, ?, ?, NULL, NULL, 'failed', ?, ?, ?)
              `).run(mp, accountId, folderNum, price, reason, nextRc);
            }

            if (nextRc >= MAX_VARIANT_GEN_RETRIES) {
              log.warn(`Variant-gen for ${mp} exhausted retries`, { folder: folderNum, retries: nextRc });
              eventBus.publish({
                type: 'alert',
                level: 'error',
                message: `❌ Crosslist auf ${mp} dauerhaft fehlgeschlagen — Variant-Gen nach ${nextRc} Versuchen aus. Manuelle Prüfung nötig.`,
              });
            } else {
              log.warn(`No usable variant for ${mp} — queued for retry (${nextRc}/${MAX_VARIANT_GEN_RETRIES})`, { folder: folderNum });
              eventBus.publish({
                type: 'alert',
                level: 'warn',
                message: `⏸ Crosslist auf ${mp} übersprungen — Variant-Gen retry ${nextRc}/${MAX_VARIANT_GEN_RETRIES}.`,
              });
            }
            crossFails++;
            continue;
          }

          // C4: Transform photos to the marketplace's preferred aspect ratio.
          // No-op for ratio-agnostic marketplaces (Vinted, KA, etc.). Cached
          // on disk so subsequent calls are O(stat).
          let mpPhotos: string[];
          try {
            mpPhotos = await transformPhotosFor(mp, photoPaths);
          } catch (err) {
            log.warn(`Photo-transform for ${mp} failed — using originals`, {
              folder: folderNum, err: err instanceof Error ? err.message : String(err),
            });
            mpPhotos = photoPaths;
          }

          const draft = {
            folderNum,
            title: mpV?.title || title,
            description: mpV?.description || description,
            category: mpV?.category || category,
            brand: mpV?.brand || brand,
            size: mpV?.size || size,
            condition: mpV?.condition || condition,
            colors: (mpV?.color ?? color) ? [mpV?.color ?? color] : [],
            material: mpV?.material || material,
            priceEur: price,
            shipping: { method: (row.shipping_method as string) ?? 'Hermes S' },
            photos: mpPhotos,
          };
          try {
            log.info(`Crosslisting to ${mp}`, { folderNum, title: draft.title });
            const base = BOT_ENDPOINTS[mp as keyof typeof BOT_ENDPOINTS];
            if (!base) { log.warn(`No bot endpoint for ${mp} — skipping crosslist`); continue; }
            const url = `${base}/api/listings/publish`;
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ account_id: accountId, draft }),
              signal: AbortSignal.timeout(300_000),
            });
            const out = await r.json() as { ok: boolean; externalId?: string; externalUrl?: string; error?: string };
            if (out.ok && out.externalId) {
              getDb().prepare(
                `INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur)
                 VALUES (?, ?, ?, ?, ?, 'active', ?)
                 ON CONFLICT(marketplace, account_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
                   external_url = excluded.external_url,
                   status = 'active',
                   list_price_eur = excluded.list_price_eur,
                   last_error = NULL,
                   updated_at = datetime('now')`,
              ).run(mp, accountId, folderNum, out.externalId, out.externalUrl ?? '', price);
              // Clean up any stale failed-NULL row from a previous attempt.
              getDb().prepare(`
                DELETE FROM marketplace_listings
                 WHERE marketplace = ? AND account_id = ? AND folder_num = ?
                   AND external_id IS NULL AND status = 'failed'
              `).run(mp, accountId, folderNum);
              log.info(`Crosslisted to ${mp}`, { folder: folderNum, externalId: out.externalId });
              eventBus.publish({
                type: 'alert',
                level: 'warn',
                message: `🔄 "${title}" auch auf ${mp} live (€${price.toFixed(2)})`,
              });
            } else {
              // C5: Persist crosslist failure so re-publisher can see it
              // (was previously only logged → endless retry loop).
              const reason = out.error ?? 'unknown error';
              persistCrosslistFailure(id, mp, accountId, folderNum, price, reason);
              crossFails++;
              log.warn(`Crosslist to ${mp} failed`, { folder: folderNum, error: reason });
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            persistCrosslistFailure(id, mp, accountId, folderNum, price, reason);
            crossFails++;
            log.warn(`Crosslist to ${mp} crashed`, {
              folder: folderNum,
              error: reason,
            });
          }
        }

        // C5: If 3+ cross-marketplaces failed (not Vinted), mark the
        // auto_listings row with a 'failed_partial' marker in last_error.
        // The CHECK constraint on `status` doesn't allow a new enum value
        // without a schema migration, so we encode the partial-failure
        // state in last_error with a stable prefix the re-publisher can
        // grep for instead. Vinted itself published successfully so we
        // keep status='published' — only the crosslist side is degraded.
        if (crossFails >= 3) {
          getDb()
            .prepare(`UPDATE auto_listings
                         SET last_error = COALESCE(last_error, '') || ?,
                             updated_at = datetime('now')
                       WHERE id = ?`)
            .run(`[failed_partial] ${crossFails} crosslist marketplaces failed; skipping in subsequent retries.`, id);
          log.warn('Auto-listing marked failed_partial (last_error)', { id, folderNum, crossFails });
          eventBus.publish({
            type: 'alert',
            level: 'error',
            message: `⚠️ Folder #${folderNum}: ${crossFails} Crosslists fehlgeschlagen — markiert als failed_partial, manuelle Prüfung.`,
          });
        }
      }
    } else {
      handlePublishFailure(id, title, folderNum, result.error ?? 'Unknown error');
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    handlePublishFailure(id, title, folderNum, error);
  }
}

// C5: Persist a crosslist failure into marketplace_listings + bump
// auto_listings.last_error so downstream re-publishers see the actual
// reason instead of looping forever. Same retry-cap pattern as C3 — we
// bump crosslist_retry_count and let the next publish cycle revisit.
function persistCrosslistFailure(
  autoListingId: number,
  mp: string,
  accountId: number,
  folderNum: number,
  priceEur: number,
  reason: string,
): void {
  const db = getDb();
  // Find existing failed row (NULL external_id) to bump retry count.
  const existing = db.prepare(`
    SELECT id, COALESCE(crosslist_retry_count, 0) AS rc
      FROM marketplace_listings
     WHERE marketplace = ? AND account_id = ? AND folder_num = ? AND external_id IS NULL
     LIMIT 1
  `).get(mp, accountId, folderNum) as { id: number; rc: number } | undefined;
  const nextRc = (existing?.rc ?? 0) + 1;
  if (existing) {
    db.prepare(`
      UPDATE marketplace_listings
         SET status = 'failed',
             last_error = ?,
             crosslist_retry_count = ?,
             updated_at = datetime('now')
       WHERE id = ?
    `).run(`Crosslist ${mp} failed: ${reason}`, nextRc, existing.id);
  } else {
    db.prepare(`
      INSERT INTO marketplace_listings (marketplace, account_id, folder_num, external_id, external_url, status, list_price_eur, last_error, crosslist_retry_count)
      VALUES (?, ?, ?, NULL, NULL, 'failed', ?, ?, ?)
    `).run(mp, accountId, folderNum, priceEur, `Crosslist ${mp} failed: ${reason}`, nextRc);
  }
  // Bump auto_listings.last_error — preserve any earlier error via COALESCE
  // so we don't overwrite a more-relevant Vinted-side failure.
  db.prepare(`
    UPDATE auto_listings
       SET last_error = COALESCE(last_error, ?),
           updated_at = datetime('now')
     WHERE id = ?
  `).run(`Crosslist ${mp} failed: ${reason}`, autoListingId);
}

// Categorize publish failures so the user sees actionable alerts.
function handlePublishFailure(id: number, title: string, folderNum: number, error: string): void {
  const lower = error.toLowerCase();
  let category: 'captcha' | 'auth' | 'network' | 'dom' | 'other' = 'other';
  let actionHint = '';

  if (lower.includes('captcha') || lower.includes('challenge') || lower.includes('verify')) {
    category = 'captcha';
    actionHint = '→ Vinted-Account manuell prüfen, evtl. CAPTCHA lösen, dann Pause für 1h.';
  } else if (lower.includes('not authenticated') || lower.includes('login') || lower.includes('unauthorized')) {
    category = 'auth';
    actionHint = '→ `npm run vinted:login` ausführen.';
  } else if (lower.includes('fetch failed') || lower.includes('timeout') || lower.includes('econnrefused')) {
    category = 'network';
    actionHint = '→ vinted-bot Service prüfen (Port 4701).';
  } else if (lower.includes('selector') || lower.includes('locator') || lower.includes('not found')) {
    category = 'dom';
    actionHint = '→ Vinted hat DOM geändert, Selektoren in vinted-bot/src/listings/selectors.ts updaten.';
  }

  getDb()
    .prepare(
      `UPDATE auto_listings SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(`[${category}] ${error}`, id);

  log.error('Listing publish failed', { id, folderNum, category, error });

  eventBus.publish({
    type: 'alert',
    level: 'error',
    message: `❌ Anzeige "${title}" failed (${category}): ${error}${actionHint ? ' ' + actionHint : ''}`,
  });

  // CAPTCHA: pause the publisher hint via setting so a downstream watcher
  // could globally back off. For now we just emit a high-priority alert.
  if (category === 'captcha') {
    log.warn('CAPTCHA detected — consider pausing auto-publisher manually', { folderNum });
  }
}

export function startAutoPublisher(): void {
  if (publisherTimer) return;
  log.info('Auto-publisher started', { intervalMs: POLL_INTERVAL_MS });
  // Start after a delay to let bots boot
  setTimeout(() => void tick(), 15_000);
  publisherTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopAutoPublisher(): void {
  if (publisherTimer) {
    clearInterval(publisherTimer);
    publisherTimer = null;
    log.info('Auto-publisher stopped');
  }
}

/** Trigger ONE publish cycle immediately, bypassing the interval but still
 * respecting `paused`, the daily cap, and the worker lock. Used by the
 * Home page "Start All" button to give immediate feedback. */
export async function runAutoPublisherNow(): Promise<void> {
  await tick();
}
