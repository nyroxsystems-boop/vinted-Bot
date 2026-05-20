// ──────────────────────────────────────────────────────────────────────────────
// Home / dashboard route. Bundles everything the new Home page needs into
// one request so the UI feels instant: CJ status, account status, listing
// counts, recent activity, paused state, daily cap.
//
// Plus: POST /api/home/start-bulk — manually kick off the auto-publisher
// (respecting paused + daily cap + lock). Returns a status string.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { getDb, getSetting, setSetting, isPaused } from '@vinted-system/shared';
import { runAutoPublisherNow } from '../auto-publisher.js';

export const homeRouter = Router();

type MarketplaceId =
  | 'vinted' | 'kleinanzeigen' | 'ebay_de' | 'ebay_uk'
  | 'depop' | 'mercari' | 'wallapop' | 'etsy' | 'grailed'
  | 'vestiaire' | 'whatnot' | 'fb_marketplace'
  | 'poshmark' | 'leboncoin' | 'marktplaats' | 'willhaben'
  | 'shopify' | 'woocommerce';

interface MarketplaceState {
  id: MarketplaceId;
  label: string;
  enabled: boolean;     // crosslist toggle
  loggedIn: boolean;    // for UI bots; for API marketplaces = "configured"
  liveListings: number;
  failedListings: number;
}

interface HomeStatus {
  paused: boolean;
  dailyCap: number;
  publishedToday: number;
  // Listing breakdown
  approved: number;
  draft: number;
  publishing: number;
  published: number;
  failed: number;
  // Live KPIs
  liveOnVinted: number;
  pendingOffers: number;
  unreadChats: number;
  soldNotShipped: number;
  // Account
  vintedLoggedIn: boolean;
  vintedUsername: string | null;
  // CJ
  cjConfigured: boolean;
  cjPendingOrders: number;
  cjFailedOrders: number;
  // Per-marketplace
  marketplaces: MarketplaceState[];
}

homeRouter.get('/status', (req, res) => {
  const db = getDb();
  // Marketplace filter: 'all' (default) or a specific marketplace.
  const mpRaw = (req.query.marketplace as string) ?? 'all';
  const mp = ['vinted', 'kleinanzeigen', 'ebay_de'].includes(mpRaw) ? mpRaw : 'all';
  const mpFilter = mp === 'all' ? '' : ` AND marketplace = '${mp}'`;

  const counts = db.prepare(`
    SELECT status, COUNT(*) AS cnt
      FROM auto_listings
     GROUP BY status
  `).all() as Array<{ status: string; cnt: number }>;
  const cMap = Object.fromEntries(counts.map(c => [c.status, c.cnt]));

  const publishedToday = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM auto_listings
     WHERE status IN ('published','publishing')
       AND updated_at > datetime('now', '-24 hours')
  `).get() as { cnt: number }).cnt;

  // Live count per marketplace (uses filter)
  const liveOnVinted = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM marketplace_listings
     WHERE status = 'active'${mpFilter || " AND marketplace = 'vinted'"}
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;

  const pendingOffers = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM offers WHERE state = 'pending'
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;

  const unreadChats = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM chats WHERE unread > 0
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;

  const soldNotShipped = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM sales
     WHERE shipped_at IS NULL
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;

  const vintedAccount = db.prepare(`
    SELECT username, logged_in FROM vinted_accounts ORDER BY id LIMIT 1
  `).get() as { username: string | null; logged_in: number } | undefined;

  // CJ is "configured" if we have either email+password (v2 auth flow) OR an
  // explicit API key. The CJ-service uses email+password to fetch an access
  // token at runtime; the key is never stored as a single env var.
  const cjEmail = process.env.CJ_EMAIL ?? '';
  const cjPass  = process.env.CJ_PASSWORD ?? '';
  const cjApiKey = getSetting('cj_api_key') ?? process.env.CJ_API_KEY ?? '';
  const cjConfigured = (cjEmail.length > 3 && cjPass.length > 5) || cjApiKey.length > 10;
  const cjPendingOrders = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM cj_orders
     WHERE status IN ('pending','created','shipping','paid')
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;
  const cjFailedOrders = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM cj_orders WHERE status = 'failed'
  `).get() as { cnt: number } | undefined)?.cnt ?? 0;

  // ── Per-marketplace state ────────────────────────────────────────────────
  const mpCounts = db.prepare(`
    SELECT marketplace, status, COUNT(*) AS cnt
      FROM marketplace_listings
     GROUP BY marketplace, status
  `).all() as Array<{ marketplace: string; status: string; cnt: number }>;
  const mpCount = (mp: string, st: string) =>
    mpCounts.find(c => c.marketplace === mp && c.status === st)?.cnt ?? 0;

  // Catalog of all 12 marketplaces with their UI metadata + auth-source.
  // For each: enabled comes from `<mp>_enabled` setting; loggedIn varies per
  // auth-mode (cookies-on-disk vs. OAuth-token vs. always-on for Vinted).
  const mpCatalog: Array<{
    id: MarketplaceId;
    label: string;
    enabled: boolean;
    loggedIn: boolean;
    countId: string; // key in marketplace_listings table
  }> = [
    {
      id: 'vinted', label: 'Vinted',
      enabled: true,
      loggedIn: !!vintedAccount?.logged_in,
      countId: 'vinted',
    },
    {
      id: 'kleinanzeigen', label: 'Kleinanzeigen',
      enabled: getSetting('kleinanzeigen_enabled') === 'true',
      loggedIn: getSetting('kleinanzeigen_logged_in') === 'true',
      countId: 'kleinanzeigen',
    },
    {
      id: 'ebay_de', label: 'eBay-DE',
      enabled: getSetting('ebay_de_enabled') === 'true',
      loggedIn: !!(getSetting('ebay_de_refresh_token') || getSetting('ebay_refresh_token') || process.env.EBAY_REFRESH_TOKEN),
      countId: 'ebay_de',
    },
    {
      id: 'ebay_uk', label: 'eBay-UK',
      enabled: getSetting('ebay_uk_enabled') === 'true',
      loggedIn: !!(getSetting('ebay_uk_refresh_token') || process.env.EBAY_UK_REFRESH_TOKEN),
      countId: 'ebay_uk',
    },
    {
      id: 'depop', label: 'Depop',
      enabled: getSetting('depop_enabled') === 'true',
      loggedIn: getSetting('depop_logged_in') === 'true',
      countId: 'depop',
    },
    {
      id: 'mercari', label: 'Mercari',
      enabled: getSetting('mercari_enabled') === 'true',
      loggedIn: getSetting('mercari_logged_in') === 'true',
      countId: 'mercari',
    },
    {
      id: 'wallapop', label: 'Wallapop',
      enabled: getSetting('wallapop_enabled') === 'true',
      loggedIn: getSetting('wallapop_logged_in') === 'true',
      countId: 'wallapop',
    },
    {
      id: 'etsy', label: 'Etsy',
      enabled: getSetting('etsy_enabled') === 'true',
      loggedIn: getSetting('etsy_logged_in') === 'true',
      countId: 'etsy',
    },
    {
      id: 'grailed', label: 'Grailed',
      enabled: getSetting('grailed_enabled') === 'true',
      loggedIn: getSetting('grailed_logged_in') === 'true',
      countId: 'grailed',
    },
    {
      id: 'vestiaire', label: 'Vestiaire',
      enabled: getSetting('vestiaire_enabled') === 'true',
      loggedIn: getSetting('vestiaire_logged_in') === 'true',
      countId: 'vestiaire',
    },
    {
      id: 'whatnot', label: 'Whatnot',
      enabled: getSetting('whatnot_enabled') === 'true',
      loggedIn: getSetting('whatnot_logged_in') === 'true',
      countId: 'whatnot',
    },
    {
      id: 'fb_marketplace', label: 'FB Marketplace',
      enabled: getSetting('fb_marketplace_enabled') === 'true',
      loggedIn: getSetting('fb_marketplace_logged_in') === 'true',
      countId: 'fb_marketplace',
    },
    {
      id: 'poshmark', label: 'Poshmark',
      enabled: getSetting('poshmark_enabled') === 'true',
      loggedIn: getSetting('poshmark_logged_in') === 'true',
      countId: 'poshmark',
    },
    {
      id: 'leboncoin', label: 'Leboncoin',
      enabled: getSetting('leboncoin_enabled') === 'true',
      loggedIn: getSetting('leboncoin_logged_in') === 'true',
      countId: 'leboncoin',
    },
    {
      id: 'marktplaats', label: 'Marktplaats',
      enabled: getSetting('marktplaats_enabled') === 'true',
      loggedIn: getSetting('marktplaats_logged_in') === 'true',
      countId: 'marktplaats',
    },
    {
      id: 'willhaben', label: 'Willhaben',
      enabled: getSetting('willhaben_enabled') === 'true',
      loggedIn: getSetting('willhaben_logged_in') === 'true',
      countId: 'willhaben',
    },
    {
      id: 'shopify', label: 'Shopify',
      enabled: getSetting('shopify_enabled') === 'true',
      loggedIn: !!(getSetting('shopify_shop') && getSetting('shopify_access_token')),
      countId: 'shopify',
    },
    {
      id: 'woocommerce', label: 'WooCommerce',
      enabled: getSetting('woocommerce_enabled') === 'true',
      loggedIn: !!(getSetting('woocommerce_url') && getSetting('woocommerce_consumer_key') && getSetting('woocommerce_consumer_secret')),
      countId: 'woocommerce',
    },
  ];

  const marketplaces: MarketplaceState[] = mpCatalog.map((m) => ({
    id: m.id,
    label: m.label,
    enabled: m.enabled,
    loggedIn: m.loggedIn,
    liveListings: mpCount(m.countId, 'active'),
    failedListings: mpCount(m.countId, 'failed'),
  }));

  const body: HomeStatus = {
    paused: isPaused(),
    dailyCap: Number(getSetting('vinted_daily_publish_cap') ?? 30),
    publishedToday,
    approved: cMap.approved ?? 0,
    draft: cMap.draft ?? 0,
    publishing: cMap.publishing ?? 0,
    published: cMap.published ?? 0,
    failed: cMap.failed ?? 0,
    liveOnVinted,
    pendingOffers,
    unreadChats,
    soldNotShipped,
    vintedLoggedIn: !!vintedAccount?.logged_in,
    vintedUsername: vintedAccount?.username ?? null,
    cjConfigured,
    cjPendingOrders,
    cjFailedOrders,
    marketplaces,
  };

  res.json(body);
});

/** POST /api/home/marketplace/:id/toggle — flip a marketplace's enabled flag. */
homeRouter.post('/marketplace/:id/toggle', (req, res) => {
  const id = req.params.id;
  // Whitelist matches the catalog in this file's home/status response.
  // Vinted is always on (it's the source); everything else is opt-in.
  const KNOWN: ReadonlyArray<string> = [
    'kleinanzeigen', 'ebay_de', 'ebay_uk', 'depop', 'mercari', 'wallapop',
    'etsy', 'grailed', 'vestiaire', 'whatnot', 'fb_marketplace', 'poshmark',
    'leboncoin', 'marktplaats', 'willhaben', 'shopify', 'woocommerce',
  ];
  if (!KNOWN.includes(id)) {
    return res.status(400).json({ ok: false, error: 'Unknown marketplace (Vinted is always on)' });
  }
  const key = `${id}_enabled`;
  const current = getSetting(key) === 'true';
  setSetting(key, current ? 'false' : 'true');
  res.json({ ok: true, enabled: !current });
});

/** POST /api/home/start-bulk — fire one publish-cycle right now.
 * Optional body: { dailyCap?: number } — temporarily raise the daily cap
 * before triggering. Caller is responsible for ensuring paused=false. */
homeRouter.post('/start-bulk', async (req, res) => {
  const cap = Number((req.body as { dailyCap?: number })?.dailyCap);
  if (cap && cap > 0 && cap < 200) {
    setSetting('vinted_daily_publish_cap', String(cap));
  }
  if (isPaused()) {
    setSetting('paused', 'false');
  }
  try {
    void runAutoPublisherNow();
    res.json({ ok: true, message: 'Auto-publisher gestartet — läuft jetzt ein Listing pro Tick (≈1/min).' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /api/home/sales — list of sold items with photo, price, EK, margin, sold-count.
 * Optional ?marketplace=vinted|kleinanzeigen|ebay_de filter. */
homeRouter.get('/sales', (req, res) => {
  const db = getDb();
  const mpRaw = (req.query.marketplace as string) ?? 'all';
  const mp = ['vinted', 'kleinanzeigen', 'ebay_de'].includes(mpRaw) ? mpRaw : null;

  const mpJoin = mp ? ` AND ml.marketplace = '${mp}'` : '';
  const mpExists = mp ? ` AND ml2.marketplace = '${mp}'` : '';

  const rows = db.prepare(`
    SELECT al.id, al.folder_num, al.title, al.photo_paths_json,
           al.price_eur AS sale_price,
           COALESCE(al.cj_cost_eur, al.temu_price_eur, 0) AS ek_price,
           al.relist_count,
           al.sold_at,
           al.last_sold_at,
           ml.marketplace, ml.external_url, ml.updated_at AS ml_sold_at,
           (SELECT title FROM auto_listing_variants v
              WHERE v.auto_listing_id = al.id AND v.marketplace = COALESCE('${mp ?? "vinted"}', 'vinted')
              LIMIT 1) AS variant_title
      FROM auto_listings al
      LEFT JOIN marketplace_listings ml ON ml.folder_num = al.folder_num AND ml.status = 'sold'${mpJoin}
     WHERE (al.sold_at IS NOT NULL OR al.last_sold_at IS NOT NULL OR al.relist_count > 0
            OR EXISTS (SELECT 1 FROM marketplace_listings ml2 WHERE ml2.folder_num = al.folder_num AND ml2.status = 'sold'${mpExists}))
     ORDER BY COALESCE(al.last_sold_at, al.sold_at, al.updated_at) DESC
     LIMIT 200
  `).all() as Array<{
    id: number; folder_num: number; title: string; photo_paths_json: string;
    sale_price: number; ek_price: number; relist_count: number;
    sold_at: string | null; last_sold_at: string | null;
    marketplace: string | null; external_url: string | null; ml_sold_at: string | null;
    variant_title: string | null;
  }>;

  const out = rows.map(r => ({
    id: r.id,
    folder_num: r.folder_num,
    title: r.variant_title || r.title.replace(/^\[Import\]\s*/, ''),
    photo_paths: JSON.parse(r.photo_paths_json ?? '[]') as string[],
    sale_price: r.sale_price,
    ek_price: r.ek_price,
    margin: Math.round((r.sale_price - r.ek_price) * 100) / 100,
    margin_pct: r.ek_price > 0 ? Math.round((r.sale_price - r.ek_price) / r.sale_price * 100) : 0,
    relist_count: r.relist_count,
    sold_count: Math.max(1, r.relist_count),  // displayed: how often verkauft (incl. re-lists)
    sold_at: r.last_sold_at || r.sold_at || r.ml_sold_at,
    marketplace: r.marketplace || 'vinted',
    external_url: r.external_url,
  }));

  // Manual sales — entries from `sales` whose listing has no `auto_listings`
  // row (typical for sales the user entered via the Manueller-Sale-Form).
  // Without this UNION they would be silently invisible in the Verkauf-Page.
  const manualRows = db.prepare(`
    SELECT s.id, s.marketplace, s.buyer_name, s.paid_at, s.created_at, s.buyer_address,
           l.id AS listing_id, l.title, l.list_price_eur, l.vinted_url, l.vinted_item_id
      FROM sales s
      JOIN listings l ON l.id = s.listing_id
     WHERE NOT EXISTS (
       SELECT 1 FROM auto_listings al
        WHERE al.folder_num IN (
          SELECT folder_num FROM marketplace_listings ml WHERE ml.external_id = CAST(l.vinted_item_id AS TEXT)
        )
     )
     ${mp ? "AND s.marketplace = '" + mp + "'" : ''}
     ORDER BY COALESCE(s.paid_at, s.created_at) DESC
     LIMIT 200
  `).all() as Array<{
    id: number; marketplace: string | null; buyer_name: string;
    paid_at: string | null; created_at: string; buyer_address: string | null;
    listing_id: number; title: string; list_price_eur: number;
    vinted_url: string; vinted_item_id: string | null;
  }>;

  const manualOut = manualRows.map(r => ({
    id: -r.id,  // negative id so it can't collide with auto_listings.id
    folder_num: 0,
    title: r.title.replace(/^\[Import\]\s*/, ''),
    photo_paths: [] as string[],
    sale_price: r.list_price_eur,
    ek_price: 0,
    margin: r.list_price_eur,
    margin_pct: 100,
    relist_count: 0,
    sold_count: 1,
    sold_at: r.paid_at || r.created_at,
    marketplace: r.marketplace || 'vinted',
    external_url: r.vinted_url.startsWith('manual:') ? null : r.vinted_url,
    manual: true,
    buyer_name: r.buyer_name,
  }));

  res.json([...out, ...manualOut].sort((a, b) => (b.sold_at ?? '').localeCompare(a.sold_at ?? '')));
});

/** GET /api/home/profit — aggregated revenue & profit for the dashboard cash
 *  tracker. Sums sold rows over four windows: today, yesterday, last 7 d, last
 *  30 d. Falls back to zeros when no sales exist so the UI renders cleanly. */
homeRouter.get('/profit', (req, res) => {
  const db = getDb();
  const mpRaw = (req.query.marketplace as string) ?? 'all';
  const mp = ['vinted', 'kleinanzeigen', 'ebay_de'].includes(mpRaw) ? mpRaw : null;
  const mpFilter = mp ? ` AND ml.marketplace = '${mp}'` : '';

  function window(sinceSql: string, untilSql: string | null = null): { revenue_eur: number; profit_eur: number; sales: number } {
    const until = untilSql ? ` AND COALESCE(al.last_sold_at, al.sold_at, ml.updated_at) < ${untilSql}` : '';
    const row = db.prepare(`
      SELECT COUNT(*) AS sales,
             COALESCE(SUM(al.price_eur), 0) AS revenue,
             COALESCE(SUM(al.price_eur - COALESCE(al.cj_cost_eur, al.temu_price_eur, 0)), 0) AS profit
        FROM auto_listings al
        LEFT JOIN marketplace_listings ml ON ml.folder_num = al.folder_num AND ml.status = 'sold'${mpFilter}
       WHERE (al.last_sold_at IS NOT NULL OR al.sold_at IS NOT NULL OR ml.status = 'sold')
         AND COALESCE(al.last_sold_at, al.sold_at, ml.updated_at) >= ${sinceSql}${until}
    `).get() as { sales: number; revenue: number; profit: number } | undefined;
    return {
      sales: row?.sales ?? 0,
      revenue_eur: Math.round((row?.revenue ?? 0) * 100) / 100,
      profit_eur:  Math.round((row?.profit ?? 0) * 100) / 100,
    };
  }

  const lastSale = (db.prepare(`
    SELECT COALESCE(al.last_sold_at, al.sold_at) AS ts
      FROM auto_listings al
     WHERE (al.last_sold_at IS NOT NULL OR al.sold_at IS NOT NULL)
     ORDER BY ts DESC LIMIT 1
  `).get() as { ts: string | null } | undefined)?.ts ?? null;

  res.json({
    ok: true,
    today:     window("datetime('now','start of day')"),
    yesterday: window("datetime('now','start of day','-1 day')", "datetime('now','start of day')"),
    last_7d:   window("datetime('now','-7 days')"),
    last_30d:  window("datetime('now','-30 days')"),
    last_sale_at: lastSale,
  });
});

/** GET /api/home/trends?days=14 — daily activity rollup for charts on Home.
 *  Returns one row per day for the requested window, including zero days. */
homeRouter.get('/trends', (req, res) => {
  const db = getDb();
  const days = Math.max(7, Math.min(60, Number((req.query.days as string) ?? '14')));

  const listingsByDay = db.prepare(`
    SELECT date(created_at) AS d, COUNT(*) AS n
      FROM auto_listings
     WHERE created_at >= date('now', ?)
     GROUP BY d
  `).all(`-${days} days`) as Array<{ d: string; n: number }>;

  const salesByDay = db.prepare(`
    SELECT date(COALESCE(last_sold_at, sold_at)) AS d,
           COUNT(*) AS n,
           ROUND(SUM(price_eur), 2) AS revenue,
           ROUND(SUM(price_eur - COALESCE(cj_cost_eur, temu_price_eur, 0)), 2) AS profit
      FROM auto_listings
     WHERE COALESCE(last_sold_at, sold_at) IS NOT NULL
       AND date(COALESCE(last_sold_at, sold_at)) >= date('now', ?)
     GROUP BY d
  `).all(`-${days} days`) as Array<{ d: string; n: number; revenue: number; profit: number }>;

  const lByDate = new Map(listingsByDay.map((r) => [r.d, r.n]));
  const sByDate = new Map(salesByDay.map((r) => [r.d, r]));

  const out: Array<{ date: string; listings: number; sales: number; revenue: number; profit: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - i);
    const date = dt.toISOString().slice(0, 10);
    const s = sByDate.get(date);
    out.push({
      date,
      listings: lByDate.get(date) ?? 0,
      sales: s?.n ?? 0,
      revenue: s?.revenue ?? 0,
      profit: s?.profit ?? 0,
    });
  }

  res.json({ ok: true, days: out });
});

/** POST /api/home/pause — toggle paused state. */
homeRouter.post('/pause', (req, res) => {
  const desired = (req.body as { paused?: boolean })?.paused;
  const newVal = desired === undefined ? (!isPaused() ? 'true' : 'false') : (desired ? 'true' : 'false');
  setSetting('paused', newVal);
  res.json({ ok: true, paused: newVal === 'true' });
});
