// MUST be first import — populates process.env from repo-root .env BEFORE
// any other module's top-level code reads it.
import './load-env.js';

import express from 'express';
import cors from 'cors';
import { createLogger, runMigrations } from '@vinted-system/shared';
import { listingsRouter } from './routes/listings.js';
import { chatsRouter } from './routes/chats.js';
import { offersRouter } from './routes/offers.js';
import { ordersRouter } from './routes/orders.js';
import { settingsRouter } from './routes/settings.js';
import { streamRouter } from './routes/stream.js';
import { statusRouter } from './routes/status.js';
import { fulfillmentRouter } from './routes/fulfillment.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { crawlerRouter } from './routes/crawler.js';
import { autoListingsRouter } from './routes/auto-listings.js';
import { purchaseQueueRouter } from './routes/purchase-queue.js';
import { accountsRouter } from './routes/accounts.js';
import { productsRouter } from './routes/products.js';
import { kleinanzeigenRouter } from './routes/kleinanzeigen.js';
import { depopRouter } from './routes/depop.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { discoveryRouter } from './routes/discovery.js';
import { modelRouter } from './routes/model.js';
import { sceneRouter } from './routes/scene.js';
import { cjRouter } from './routes/cj.js';
import { profitRouter } from './routes/profit.js';
import { aiRouter } from './routes/ai.js';
import { crosslistRouter } from './routes/crosslist.js';
import { relistRouter } from './routes/relist.js';
import { salesRouter } from './routes/sales.js';
import { ebayRouter } from './routes/ebay.js';
import { shopifyRouter } from './routes/shopify.js';
import { woocommerceRouter } from './routes/woocommerce.js';
import { botRouter } from './routes/bot.js';
import { captchaRouter } from './routes/captcha.js';
import { homeRouter } from './routes/home.js';
import { assetsRouter } from './routes/assets.js';
import { trendsRouter } from './routes/trends.js';
import { walletRouter } from './routes/wallet.js';
import { refundsRouter } from './routes/refunds.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startListingWatcher, stopListingWatcher } from './listing-watcher.js';
import { startAutoPublisher, stopAutoPublisher } from './auto-publisher.js';
import { startListingRefresher, stopListingRefresher } from './listing-refresher.js';
import { startSalesFulfillment, stopSalesFulfillment } from './sales-fulfillment.js';
import { startImageGenerator, stopImageGenerator } from './image-generator.js';
import { startCjDiscovery, stopCjDiscovery, runCjDiscoveryOnce } from './cj-discovery.js';
import { startPerformanceCollector, stopPerformanceCollector } from './performance-collector.js';
import { startAccountMetricsCollector, stopAccountMetricsCollector } from './account-metrics-collector.js';
import { startRepricer, stopRepricer } from './repricer.js';
import { startReplyAutopilot, stopReplyAutopilot } from './reply-autopilot.js';
import { startKleinanzeigenPipeline, stopKleinanzeigenPipeline } from './kleinanzeigen-pipeline.js';
import { startDepopPipeline, stopDepopPipeline } from './depop-pipeline.js';
import { startCJFulfillment, stopCJFulfillment } from './cj-fulfillment.js';
import { startCjAutoMatcher, stopCjAutoMatcher } from './cj-auto-matcher.js';
import { startRelister, stopRelister } from './relister.js';
import { startDbBackup, stopDbBackup } from './db-backup.js';
import { startFailedListingRetrier, stopFailedListingRetrier } from './failed-listings-retrier.js';
import { startSessionHealthCheck, stopSessionHealthCheck } from './session-health-check.js';
import { startSoldItemsPoller, stopSoldItemsPoller } from './sold-items-poller.js';
import { startKaSaleDetector, stopKaSaleDetector } from './ka-sale-detector.js';
import { startEbaySaleDetector, stopEbaySaleDetector } from './ebay-sale-detector.js';
import { startVariantGenerator, stopVariantGenerator } from './variant-generator.js';
import { startCrossSync, stopCrossSync } from './cross-sync.js';
import { startEuBots } from './eu-marketplace-bots.js';
import { startTelegramAlerts, stopTelegramAlerts } from './telegram-alerts.js';
import { startBotWatchdog, stopBotWatchdog } from './bot-watchdog.js';
import { startVintedTrendWorker, stopVintedTrendWorker } from './vinted-trend-worker.js';
import { startConversionTracker, stopConversionTracker } from './conversion-tracker.js';
import { startAccountHealthWatcher, stopAccountHealthWatcher } from './account-health-watcher.js';
import { startSalesKiller, stopSalesKiller } from './sales-killer.js';
import { startWalletPayoutWorker, stopWalletPayoutWorker } from './wallet-payout-worker.js';
import { startRefundWorkflow, stopRefundWorkflow } from './refund-workflow.js';
import { startProxyHealthMonitor, stopProxyHealthMonitor } from './proxy-health-monitor.js';
import { accountHealthRouter } from './routes/account-health.js';
import { requireAuth, getAuthToken } from './middleware/auth.js';

const log = createLogger('orchestrator');
const PORT = Number.parseInt(process.env.ORCHESTRATOR_PORT ?? '4700', 10);

// Ensure DB exists/migrated before any route reads it.
runMigrations();

// Settings → env-var hydration. Workers read API-keys from process.env, but
// the onboarding wizard persists them in the settings table. Copy any
// settings-table key into process.env at boot so workers see them without
// the user having to edit .env or restart the host. The reverse is also
// implicit: an explicit env-var still wins on subsequent runs because we
// only set the env when it's currently empty.
import { getSetting } from '@vinted-system/shared';
function hydrateEnvFromSettings() {
  const mapping: Array<[string, string]> = [
    ['gemini_api_key',    'GEMINI_API_KEY'],
    ['anthropic_api_key', 'ANTHROPIC_API_KEY'],
    ['openai_api_key',    'OPENAI_API_KEY'],
    ['cj_api_key',        'CJ_API_KEY'],
    ['cj_email',          'CJ_EMAIL'],
    ['stripe_secret_key', 'STRIPE_SECRET_KEY'],
  ];
  for (const [settingKey, envKey] of mapping) {
    if (process.env[envKey] && process.env[envKey]!.trim().length > 0) continue;
    const stored = getSetting(settingKey)?.trim();
    if (stored) process.env[envKey] = stored;
  }
}
hydrateEnvFromSettings();

const app = express();
// CORS: reflect the request's origin. The orchestrator listens only on
// 127.0.0.1 (see app.listen below), so the LAN can't reach it — only local
// processes can. Real protection is the `requireAuth` Bearer-token gate.
// CORS is just a browser-side hint; locking it down to a static list
// breaks Tauri v2 builds where the asset-protocol origin varies by OS
// (tauri://localhost on Win, https://tauri.localhost on macOS, etc).
app.use(cors({
  origin: true,
  credentials: true,
}));
// 1 MB is plenty for JSON API payloads. Asset uploads use multipart endpoints,
// not raw JSON, so this no longer needs to absorb base64-inflated images.
app.use(express.json({ limit: '1mb' }));

// Loopback-only token bootstrap — Tauri shell / dashboard fetches the
// orchestrator's bearer token via this endpoint at startup. Must be
// registered BEFORE `requireAuth` so it stays accessible without a token.
app.get('/auth/token', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    return res.status(403).end();
  }
  res.json({ token: getAuthToken() });
});

// Bearer-token gate for every other route. `/health`, `/health/deep` and
// `/auth/token` are in the bypass list inside requireAuth itself.
app.use(requireAuth);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'orchestrator' }));

// Deep health: aggregated production readiness check.
// Use this for monitoring / pre-flight before approving a wave of listings.
app.get('/health/deep', async (_req, res) => {
  const { getDb, getSetting } = await import('@vinted-system/shared');
  const db = getDb();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. DB writable
  try {
    db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('_health_ping', datetime('now'))`).run();
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: e instanceof Error ? e.message : 'write failed' };
  }

  // 2. vinted-bot reachable
  try {
    const r = await fetch(`http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}/health`, { signal: AbortSignal.timeout(5_000) });
    checks.vinted_bot = { ok: r.ok };
  } catch (e) {
    checks.vinted_bot = { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
  }

  // 3. cj-service reachable
  try {
    const r = await fetch(`${process.env.CJ_SERVICE_URL ?? 'http://localhost:4720'}/health`, { signal: AbortSignal.timeout(5_000) });
    checks.cj_service = { ok: r.ok };
  } catch (e) {
    checks.cj_service = { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
  }

  // 4. Vinted session valid?
  const sessionLastOk = getSetting('vinted_session_last_ok');
  const sessionLastAlert = getSetting('vinted_session_last_alert');
  const sessionHealthy = sessionLastOk && (!sessionLastAlert ||
    new Date(sessionLastOk).getTime() > new Date(sessionLastAlert).getTime());
  checks.vinted_session = { ok: !!sessionHealthy, detail: sessionLastOk ? `last_ok=${sessionLastOk}` : 'never_checked' };

  // 5. Last successful tick per worker — read from heartbeat settings written
  //    by withLock(). Threshold tuned to each worker's expected interval.
  const workers: Array<{ name: string; thresholdMin: number }> = [
    { name: 'auto-publisher', thresholdMin: 5 },
    { name: 'cj-fulfillment', thresholdMin: 60 },
    { name: 'relister', thresholdMin: 60 },
    { name: 'db-backup', thresholdMin: 8 * 60 },
    { name: 'failed-retrier', thresholdMin: 30 },
    { name: 'session-health', thresholdMin: 20 },
    { name: 'sold-items-poller', thresholdMin: 60 },
    { name: 'ka-pipeline', thresholdMin: 10 },
    { name: 'ka-sale-detector', thresholdMin: 90 },
  ];
  for (const w of workers) {
    const heartbeat = getSetting(`_worker_${w.name}_last_ok`);
    if (!heartbeat) {
      checks[`worker_${w.name}`] = { ok: false, detail: 'never_ran' };
      continue;
    }
    // SQLite datetime('now') is UTC without TZ marker — parse explicitly as UTC.
    const utcStr = heartbeat.replace(' ', 'T') + 'Z';
    const ageMin = (Date.now() - new Date(utcStr).getTime()) / 60_000;
    checks[`worker_${w.name}`] = {
      ok: ageMin < w.thresholdMin,
      detail: `${Math.round(ageMin)}min ago`,
    };
  }

  // 6. Daily-cap utilization
  const todayPub = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM auto_listings
     WHERE status IN ('published','publishing') AND updated_at > datetime('now', '-24 hours')
  `).get() as { cnt: number }).cnt;
  const pubCap = Number(getSetting('vinted_daily_publish_cap') ?? '30');
  checks.daily_publish_usage = { ok: todayPub < pubCap, detail: `${todayPub}/${pubCap}` };

  const todayRelist = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM auto_listings
     WHERE parent_folder_num IS NOT NULL AND created_at > datetime('now', '-24 hours')
  `).get() as { cnt: number }).cnt;
  const relistCap = Number(getSetting('relist_max_per_day') ?? '30');
  checks.daily_relist_usage = { ok: todayRelist < relistCap, detail: `${todayRelist}/${relistCap}` };

  const todayCJ = (db.prepare(`
    SELECT COUNT(*) AS cnt FROM cj_orders WHERE ordered_at > datetime('now', '-24 hours')
  `).get() as { cnt: number }).cnt;
  const cjCap = Number(getSetting('cj_max_daily_orders') ?? '50');
  checks.daily_cj_usage = { ok: todayCJ < cjCap, detail: `${todayCJ}/${cjCap}` };

  // 7. Stuck items
  const failedListings = (db.prepare(`SELECT COUNT(*) AS cnt FROM auto_listings WHERE status='failed' AND retry_count >= 3`).get() as { cnt: number }).cnt;
  checks.failed_listings_stuck = { ok: failedListings === 0, detail: `${failedListings} archived-pending` };

  const stuckCJ = (db.prepare(`SELECT COUNT(*) AS cnt FROM cj_orders WHERE status='ordered' AND ordered_at < datetime('now', '-48 hours')`).get() as { cnt: number }).cnt;
  checks.cj_orders_stuck = { ok: stuckCJ === 0, detail: `${stuckCJ} >48h without tracking` };

  // 8. Backups present
  try {
    const { _internal } = await import('./db-backup.js');
    const fs = await import('node:fs');
    const dir = _internal.backupDir();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.db')) : [];
    checks.db_backup = { ok: files.length > 0, detail: `${files.length} snapshots` };
  } catch (e) {
    checks.db_backup = { ok: false, detail: e instanceof Error ? e.message : 'error' };
  }

  const overall = Object.values(checks).every(c => c.ok);
  res.status(overall ? 200 : 503).json({ ok: overall, checks });
});

app.use('/api/home', homeRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/offers', offersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/status', statusRouter);
app.use('/api/fulfillment', fulfillmentRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/auth', authRouter);
app.use('/api/crawler', crawlerRouter);
app.use('/api/auto-listings', autoListingsRouter);
app.use('/api/purchase-queue', purchaseQueueRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/products', productsRouter);
app.use('/api/bot', botRouter);
app.use('/api/kleinanzeigen', kleinanzeigenRouter);
app.use('/api/depop', depopRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/discovery', discoveryRouter);
app.use('/api/model', modelRouter);
app.use('/api/scene', sceneRouter);
app.use('/api/cj', cjRouter);
app.use('/api/profit', profitRouter);
app.use('/api/ai', aiRouter);
app.use('/api/crosslist', crosslistRouter);
app.use('/api/relist', relistRouter);
app.use('/api/sales', salesRouter);
app.use('/api/ebay', ebayRouter);
app.use('/api/shopify', shopifyRouter);
app.use('/api/woocommerce', woocommerceRouter);
app.use('/api/captcha', captchaRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/refunds', refundsRouter);
// Account-health routes mount at /api root so paths read as
// /api/accounts/:id/health, /api/accounts/:id/unpause, /api/health/dashboard.
app.use('/api', accountHealthRouter);
app.use('/stream', streamRouter);

const server = app.listen(PORT, '127.0.0.1', () => {
  log.info(`Orchestrator listening on http://127.0.0.1:${PORT}`);
  startScheduler();
  startImageGenerator();
  startCjDiscovery();
  startListingWatcher();
  startAutoPublisher();
  startListingRefresher();
  startSalesFulfillment();
  startCJFulfillment();
  startRelister();
  startFailedListingRetrier();
  startSessionHealthCheck();
  startSoldItemsPoller();
  startDbBackup();
  // Vinted + Kleinanzeigen Setup (multi-marketplace).
  startCrossSync();
  startPerformanceCollector(24);
  startAccountMetricsCollector();
  startRepricer();
  startReplyAutopilot();
  startKleinanzeigenPipeline();
  startDepopPipeline();
  startKaSaleDetector();
  startEbaySaleDetector();
  startVariantGenerator();
  startCjAutoMatcher();
  // EU-Bots (leboncoin/marktplaats/willhaben/subito/ricardo) bleiben aus.
  // try { startEuBots(); } catch (e) { log.warn('EU bots failed to start', { error: String(e) }); }
  startTelegramAlerts();
  startBotWatchdog();
  startVintedTrendWorker();
  startConversionTracker();
  startAccountHealthWatcher();
  startProxyHealthMonitor();
  startSalesKiller();
  startWalletPayoutWorker();
  startRefundWorkflow();
});

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal} — shutting down`);
  stopScheduler();
  stopImageGenerator();
  stopCjDiscovery();
  stopListingWatcher();
  stopAutoPublisher();
  stopListingRefresher();
  stopSalesFulfillment();
  stopCJFulfillment();
  stopRelister();
  stopFailedListingRetrier();
  stopSessionHealthCheck();
  stopSoldItemsPoller();
  stopDbBackup();
  stopCrossSync();
  stopKleinanzeigenPipeline();
  stopDepopPipeline();
  stopKaSaleDetector();
  stopEbaySaleDetector();
  stopVariantGenerator();
  stopCjAutoMatcher();
  stopPerformanceCollector();
  stopAccountMetricsCollector();
  stopRepricer();
  stopReplyAutopilot();
  stopTelegramAlerts();
  stopBotWatchdog();
  stopVintedTrendWorker();
  stopConversionTracker();
  stopAccountHealthWatcher();
  stopProxyHealthMonitor();
  stopSalesKiller();
  stopWalletPayoutWorker();
  stopRefundWorkflow();
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
