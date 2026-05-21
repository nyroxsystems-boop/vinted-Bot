import express, { type Request, type Response } from 'express';
import {
  createLogger,
  startBotRun,
  finishBotRun,
  getDb,
  getCurrentAccountId,
  setCurrentAccountId,
  requireAccount,
  getBlockState as getBlockStateImport,
  clearBlock as clearBlockImport,
  listAccountsFor,
  markAccountLoggedOut,
} from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { vintedQueue } from './queue.js';
import { pollVintedInbox } from './chats/poll.js';
import { acceptOffer } from './offers/accept.js';
import { declineOffer } from './offers/decline.js';
import { pollSaleStatuses } from './sales/track.js';
import { scanSoldItems } from './sales/scan.js';
import { downloadLabelForSale } from './sales/download-label.js';
import { leaveFeedbackForSale } from './sales/leave-feedback.js';
import { createListing, type ListingInput } from './listings/create.js';
import { createListingApi } from './listings/create-via-api.js';
import { updateListingPrice } from './listings/update-price.js';
import { vintedAdapter } from './adapter.js';
import type { ListingDraft } from '@vinted-system/shared';
import {
  startLogin,
  getLoginFlowStatus,
  isLoginInProgress,
  getSessionTracker,
} from './login-flow.js';

/**
 * Resolve the target account for an API call.
 * Precedence: ?account= query → body.accountId → currently-selected account.
 * Throws (→ 400) if the id doesn't exist.
 */
function resolveAccount(req: Request): number {
  const raw = (req.query.account as string | undefined)
    ?? (req.body?.accountId as string | number | undefined);
  const id = raw === undefined ? getCurrentAccountId() : Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Invalid account id: ${raw}`);
  requireAccount(id);
  return id;
}

const log = createLogger('vinted-api');
const PORT_HINT = Number(process.env.VINTED_BOT_PORT ?? 4701);

export function createVintedApi(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ── MarketplaceAdapter HTTP Endpoints (gemeinsame API für push-multi) ──

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, marketplace: 'vinted', port: PORT_HINT });
  });
  // Also expose at /health (without /api prefix) so the orchestrator's
  // /health/deep probe finds us without a 404.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, marketplace: 'vinted', port: PORT_HINT });
  });

  app.get('/api/auth/status', async (req, res) => {
    const accountId = Number(req.query.account_id ?? 1);
    try {
      const ok = await vintedAdapter.isAuthenticated(accountId);
      res.json({ ok, accountId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const accountId = Number(req.body?.account_id ?? 1);
    try {
      const result = await vintedAdapter.login(accountId);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/listings/publish', async (req, res) => {
    const accountId = Number(req.body?.account_id ?? 1);
    const draft = req.body?.draft as ListingDraft | undefined;
    if (!draft) return res.status(400).json({ ok: false, error: 'missing draft' });
    const runId = startBotRun('vinted', 'adapter_publish');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(
        () => vintedAdapter.publish(accountId, draft),
        `adapter_publish_${accountId}_${draft.title.slice(0, 30)}`,
      );
      if (result.ok) {
        tracker.markValid();
        finishBotRun(runId, 'success');
      } else {
        finishBotRun(runId, 'failure', result.error);
      }
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/api/listings/deactivate', async (req, res) => {
    const accountId = Number(req.body?.account_id ?? 1);
    const externalId = req.body?.external_id as string | undefined;
    if (!externalId) return res.status(400).json({ ok: false, error: 'missing external_id' });
    try {
      const result = await vintedQueue.enqueue(
        () => vintedAdapter.deactivate(accountId, externalId),
        `adapter_deactivate_${accountId}_${externalId.slice(-12)}`,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/auth/reset-profile', async (req, res) => {
    const accountId = Number(req.body?.account_id ?? 1);
    try {
      const { resetVintedProfile } = await import('./browser.js');
      const result = await resetVintedProfile(accountId);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/block-status', (_req, res) => {
    try {
      const state = getBlockStateImport('vinted');
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/block-status/clear', (_req, res) => {
    try {
      clearBlockImport('vinted');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/listings/update-price', async (req, res) => {
    const accountId = Number(req.body?.account_id ?? 1);
    const externalId = req.body?.external_id as string | undefined;
    const newPrice = Number(req.body?.new_price_eur);
    if (!externalId || !Number.isFinite(newPrice)) {
      return res.status(400).json({ ok: false, error: 'missing external_id or new_price_eur' });
    }
    try {
      const result = await vintedQueue.enqueue(
        () => vintedAdapter.updatePrice(accountId, externalId, newPrice),
        `adapter_price_${accountId}_${externalId.slice(-12)}`,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/status', (req: Request, res: Response) => {
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    res.json({
      bot: 'vinted',
      account_id: accountId,
      queue: vintedQueue.stats(),
      session: getSessionTracker(accountId).snapshot(),
      login: getLoginFlowStatus(),
    });
  });

  // Login-Flow endpoints — account-scoped. The query param ?account=<id>
  // selects which account to log in; defaults to the current one.
  app.post('/login/start', async (req, res) => {
    if (isLoginInProgress()) {
      return res.status(409).json({ ok: false, error: 'Login läuft bereits' });
    }
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    // startLogin() returns once flow-state is initialized; the actual browser
    // session runs fire-and-forget inside it. Awaiting catches synchronous
    // setup failures (e.g. "Login läuft bereits" from a race) so the UI gets
    // a 409 instead of a misleading 200-ok-with-nothing-running.
    try {
      await startLogin(accountId);
      res.json({ ok: true, status: getLoginFlowStatus() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const conflict = /läuft bereits|in progress/i.test(msg);
      res.status(conflict ? 409 : 500).json({ ok: false, error: msg });
    }
  });

  app.get('/login/status', (req, res) => {
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    res.json({
      session: getSessionTracker(accountId).snapshot(),
      login: getLoginFlowStatus(),
    });
  });

  // Switch the "current" account — what endpoints default to when no
  // ?account= query is given. Persisted in settings so the orchestrator
  // and dashboard stay in sync.
  app.post('/accounts/select', (req, res) => {
    const id = Number(req.body?.accountId);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'accountId required' });
    }
    try {
      setCurrentAccountId(id);
      res.json({ ok: true, accountId: id });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/circuit-breaker/reset', (_req, res) => {
    vintedQueue.resetCircuitBreaker();
    res.json({ ok: true });
  });

  // Kill every cached Playwright context (closes all account browsers).
  // Does NOT wipe profile dirs — cookies persist on disk, so a fresh
  // /login/start re-uses them. With ?wipe=true the chromium-profile of every
  // vinted account is deleted as well (full logout, must re-login).
  // Use case: user wants to free resources before logging into a new account,
  // or wants to start over completely.
  app.post('/sessions/kill-all', async (req, res) => {
    const wipe = req.query.wipe === 'true' || req.body?.wipe === true;
    // Surface in-flight queue work so the caller knows the kill happened
    // mid-operation (e.g. a listing was being submitted). It's not a refusal
    // — the user explicitly asked to kill everything — just visibility.
    // pending + currently-processing counts both matter to the user.
    const stats = vintedQueue.stats();
    const inFlight = (stats.isProcessing ? 1 : 0) + stats.pending;
    try {
      const { closeVintedBrowser } = await import('./browser.js');
      await closeVintedBrowser();
      const accounts = listAccountsFor('vinted');
      const failed: Array<{ id: number; step: string; error: string }> = [];
      let wiped = 0;
      if (wipe) {
        const { resetVintedProfile } = await import('./browser.js');
        for (const acc of accounts) {
          const r = await resetVintedProfile(acc.id);
          if (r.ok) wiped++;
          else failed.push({ id: acc.id, step: 'wipe', error: r.error ?? 'unknown' });
        }
      }
      for (const acc of accounts) {
        try {
          markAccountLoggedOut(acc.id);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.warn('markAccountLoggedOut failed', { accountId: acc.id, error });
          failed.push({ id: acc.id, step: 'mark_logged_out', error });
        }
      }
      log.warn('All vinted browser sessions killed', {
        wipe,
        accounts: accounts.length,
        wiped,
        failed: failed.length,
        in_flight_at_kill: inFlight,
      });
      res.json({
        ok: true,
        closed: accounts.length,
        wiped,
        wipe,
        failed,
        in_flight_at_kill: inFlight,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Reject auth-requiring operations if login is running — the browser
  // is busy and session state is mid-flight.
  const rejectIfLogin = (res: Response): boolean => {
    if (isLoginInProgress()) {
      res.status(409).json({ ok: false, error: 'Login läuft — bitte warten' });
      return true;
    }
    return false;
  };

  // Auto-launch login when we detect an auth error for a given account.
  const maybeAutoLogin = (err: unknown, accountId: number): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not authenticated|login|session expired|unauthorized/i.test(msg)) {
      if (!isLoginInProgress()) {
        log.warn('Session invalid — auto-starting login flow', { accountId });
        startLogin(accountId).catch(() => {
          /* captured in flow status */
        });
      }
    }
  };

  // Trigger one poll cycle for inbox messages + offer detection.
  // Per-account via ?account=<id>; defaults to current-active.
  app.post('/poll/inbox', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'poll_inbox');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(
        () => pollVintedInbox(accountId),
        `poll_inbox_${accountId}`,
      );
      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, accountId, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/poll/sales', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'poll_sales');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(
        () => pollSaleStatuses(accountId),
        `poll_sales_${accountId}`,
      );
      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, accountId, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // Direct-Buy detector: scans /member/transactions for sold items that
  // never had a corresponding offer (Sofort-Kaufen path). Inserts missing
  // sales rows so CJ-fulfillment + Re-Lister can pick them up.
  app.post('/scan/sold-items', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'scan_sold_items');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(
        () => scanSoldItems(accountId),
        `scan_sold_${accountId}`,
      );
      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, accountId, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // Resolve the account that owns an offer via chat → account.
  const accountForOffer = (offer: Offer): number => {
    const row = getDb()
      .prepare('SELECT account_id FROM chats WHERE id = ?')
      .get(offer.chat_id) as { account_id: number } | undefined;
    return row?.account_id ?? getCurrentAccountId();
  };

  app.post('/offers/:id/accept', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const decidedBy = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
    const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
    if (!offer) return res.status(404).json({ ok: false, error: 'Offer not found' });
    const accountId = accountForOffer(offer);

    const runId = startBotRun('vinted', 'accept_offer');
    try {
      const result = await vintedQueue.enqueue(
        () => acceptOffer(offer, decidedBy, accountId),
        `accept_offer_${id}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/offers/:id/decline', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const decidedBy = req.body?.decidedBy === 'manual' ? 'manual' : 'auto';
    const offer = getDb().prepare('SELECT * FROM offers WHERE id = ?').get(id) as Offer | undefined;
    if (!offer) return res.status(404).json({ ok: false, error: 'Offer not found' });
    const accountId = accountForOffer(offer);

    const runId = startBotRun('vinted', 'decline_offer');
    try {
      const result = await vintedQueue.enqueue(
        () => declineOffer(offer, decidedBy, accountId),
        `decline_offer_${id}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Listing creation ─────────────────────────────────────────────────────
  // POST /listings/create — create a new Vinted listing via Playwright.
  // Called by the orchestrator's auto-publisher when an auto_listing
  // transitions from 'approved' to 'publishing'.
  app.post('/listings/create', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const input = req.body as ListingInput;
    if (!input.title || !input.photoPaths?.length) {
      return res.status(400).json({ ok: false, error: 'title and photoPaths required' });
    }
    let accountId: number;
    try {
      accountId = resolveAccount(req);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    // ?via=api → use Vinted's JSON API (fast, no UI clicks)
    // default → headful Playwright UI (legacy)
    const useApi = req.query.via === 'api' || (req.body as any)?.via === 'api';
    const fn = useApi ? createListingApi : createListing;

    const runId = startBotRun('vinted', 'create_listing');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(
        () => fn(input, accountId),
        `create_listing_${accountId}_${input.title.slice(0, 30)}`,
      );
      if (result.ok) {
        tracker.markValid();
        finishBotRun(runId, 'success');
      } else {
        maybeAutoLogin(new Error(result.error ?? 'unknown'), accountId);
        finishBotRun(runId, 'failure', result.error);
      }
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Chat message sending ───────────────────────────────────────────────
  // POST /chats/:chatId/send — send a message to a buyer's chat.
  // Used by the orchestrator for auto-counter offers.
  app.post('/chats/:chatId/send', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const chatId = Number.parseInt(req.params.chatId, 10);
    // Accept both `message` (new canonical) and `body` (legacy from
    // reply-autopilot pre-fix) so a version-skew between orchestrator and
    // vinted-bot doesn't silently kill all auto-replies.
    const { message, body } = req.body as { message?: string; body?: string };
    const text = message ?? body;
    if (!text) return res.status(400).json({ ok: false, error: 'message required' });

    const chat = getDb()
      .prepare('SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?')
      .get(chatId) as { vinted_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });

    const accountId = chat.account_id ?? getCurrentAccountId();
    const runId = startBotRun('vinted', 'send_message');
    const tracker = getSessionTracker(accountId);
    try {
      const result = await vintedQueue.enqueue(async () => {
        const mb = await (await import('./browser.js')).getVintedBrowser(accountId);
        const page = await mb.context.newPage();
        try {
          await (await import('./auth.js')).requireLogin(page, accountId);
          await page.goto(`${process.env.VINTED_BASE_URL ?? 'https://www.vinted.de'}/inbox/${chat.vinted_conversation_id}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);

          const { VINTED } = await import('./selectors.js');
          const textarea = page.locator(VINTED.textInput).first();
          await textarea.waitFor({ state: 'visible', timeout: 10_000 });
          await textarea.fill(text);
          await page.waitForTimeout(300);

          const sendBtn = page.locator(VINTED.sendButton).first();
          await sendBtn.click({ timeout: 5_000 });
          await page.waitForTimeout(1_500);

          return { ok: true as const };
        } finally {
          await page.close();
        }
      }, `send_msg_${chatId}`);

      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Shipping-label download ────────────────────────────────────────────
  // Resolve the account that owns a sale via listing → account.
  const accountForSale = (saleId: number): number => {
    const row = getDb()
      .prepare(
        `SELECT l.account_id FROM sales s
           JOIN listings l ON l.id = s.listing_id
          WHERE s.id = ?`,
      )
      .get(saleId) as { account_id: number } | undefined;
    return row?.account_id ?? getCurrentAccountId();
  };

  app.post('/sales/:id/label', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const saleId = Number.parseInt(req.params.id, 10);
    const accountId = accountForSale(saleId);
    const runId = startBotRun('vinted', 'download_label');
    try {
      const result = await vintedQueue.enqueue(
        () => downloadLabelForSale(saleId, accountId),
        `download_label_${saleId}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/sales/:id/feedback', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const saleId = Number.parseInt(req.params.id, 10);
    const accountId = accountForSale(saleId);
    const runId = startBotRun('vinted', 'leave_feedback');
    try {
      const result = await vintedQueue.enqueue(
        () => leaveFeedbackForSale(saleId, accountId),
        `feedback_${saleId}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'skipped', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/listings/:itemId/price', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const { itemId } = req.params;
    const { price } = req.body as { price?: number };
    if (typeof price !== 'number' || price <= 0) {
      return res.status(400).json({ ok: false, error: 'price (number) required' });
    }
    // Which account owns this vinted item?
    const row = getDb()
      .prepare('SELECT account_id FROM listings WHERE vinted_item_id = ?')
      .get(itemId) as { account_id: number } | undefined;
    const accountId = row?.account_id ?? getCurrentAccountId();
    const runId = startBotRun('vinted', 'update_price');
    try {
      const result = await vintedQueue.enqueue(
        () => updateListingPrice(itemId, price, accountId),
        `update_price_${itemId}`,
      );
      finishBotRun(runId, result.ok ? 'success' : 'failure', result.error);
      res.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Profile Stats ──────────────────────────────────────────────────────
  // Scrapes the logged-in account's profile + wallet page for follower
  // counts, ratings, balance, verified-badge, and surface warnings on any
  // sub-step that failed. Called by the orchestrator's
  // account-metrics-collector once per 24h per account.
  app.get('/api/profile/stats', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = Number(req.query.account_id ?? req.query.account ?? getCurrentAccountId());
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw new Error(`Invalid account_id: ${req.query.account_id}`);
      }
      requireAccount(accountId);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'profile_stats');
    const tracker = getSessionTracker(accountId);
    try {
      const { scrapeProfileStats } = await import('./profile-scraper.js');
      const stats = await vintedQueue.enqueue(
        () => scrapeProfileStats(accountId),
        `profile_stats_${accountId}`,
      );
      // Treat "not_authenticated" warning as a soft failure — caller can
      // inspect warnings[] and decide whether to start re-login.
      if (stats.warnings.includes('not_authenticated')) {
        finishBotRun(runId, 'failure', 'not_authenticated');
      } else {
        tracker.markValid();
        finishBotRun(runId, 'success');
      }
      res.json({ ok: true, accountId, stats });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Proxy Test ─────────────────────────────────────────────────────────
  // POST /api/proxy/test  body: { proxy_url }
  // Launches a temporary non-persistent browser context through the proxy,
  // fetches https://api.ipify.org to read the egress IP, compares to the
  // direct IP, and optionally enriches with country via ipapi.co.
  app.post('/api/proxy/test', async (req, res) => {
    const proxyUrl = req.body?.proxy_url as string | undefined;
    if (!proxyUrl) return res.status(400).json({ ok: false, error: 'proxy_url required' });

    // Refuse private / loopback / link-local destinations. Without this,
    // a leaked auth-token could be used to tunnel Playwright traffic through
    // the user's internal network (router admin UIs, k8s services, etc).
    // We only allow public IPs and DNS hostnames.
    try {
      const u = new URL(proxyUrl);
      const host = u.hostname;
      const isLoopback = /^(127\.|::1$|localhost$)/i.test(host);
      const isPrivate = /^(10\.|192\.168\.|169\.254\.)/.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        || /^fc[0-9a-f]{2}:/i.test(host)
        || /^fe80:/i.test(host);
      if (isLoopback || isPrivate) {
        return res.status(400).json({
          ok: false,
          error: `Proxy-Host "${host}" ist privat/loopback — nur öffentliche Proxy-Server erlaubt.`,
        });
      }
    } catch {
      return res.status(400).json({ ok: false, error: 'proxy_url ist keine gültige URL' });
    }

    const { chromium } = await import('playwright');
    const { parseProxyUrl } = await import('@vinted-system/shared');

    let proxyOpt;
    try {
      proxyOpt = parseProxyUrl(proxyUrl, 'proxy-test');
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    // ── Fetch direct IP (no proxy) in parallel with proxy IP ──────────────
    const directIpPromise = fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => r.json() as Promise<{ ip: string }>)
      .then((j) => j.ip)
      .catch(() => null);

    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        proxy: proxyOpt,
        timeout: 20_000,
      });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const resp = await page.goto('https://api.ipify.org?format=json', {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      const body = await resp?.text();
      const proxyIp = body ? (JSON.parse(body) as { ip: string }).ip : null;
      await ctx.close();
      await browser.close();
      browser = undefined;

      if (!proxyIp) {
        return res.json({ ok: false, error: 'Konnte Proxy-IP nicht ermitteln' });
      }

      const directIp = await directIpPromise;

      // Country lookup — best-effort, never fails the request.
      let country: string | undefined;
      try {
        const r = await fetch(`https://ipapi.co/${proxyIp}/json/`, {
          signal: AbortSignal.timeout(5_000),
        });
        const j = (await r.json()) as { country_name?: string; country?: string };
        country = j.country_name ?? j.country;
      } catch { /* ignore */ }

      res.json({
        ok: true,
        proxyIp,
        directIp,
        changed: directIp ? proxyIp !== directIp : null,
        country,
      });
    } catch (err) {
      if (browser) await browser.close().catch(() => null);
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Vinted Trends ─────────────────────────────────────────────────────
  // Scrapes Vinted's own top-brands / top-searches / hot-hashtags pages so
  // CJ-Discovery can target what Vinted-buyers actually want. The route is
  // queued through vintedQueue because the scraper drives Playwright and
  // must not run concurrently with listing/poll operations on the same
  // account-scoped browser context.
  app.post('/api/trends/scrape', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const accountId = Number(req.body?.account_id ?? req.body?.accountId ?? getCurrentAccountId());
    if (!Number.isFinite(accountId) || accountId <= 0) {
      return res.status(400).json({ ok: false, error: 'account_id required' });
    }
    try {
      requireAccount(accountId);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'scrape_trends');
    const tracker = getSessionTracker(accountId);
    try {
      const { scrapeVintedTrends } = await import('./trend-scraper.js');
      const trends = await vintedQueue.enqueue(
        () => scrapeVintedTrends(accountId),
        `scrape_trends_${accountId}`,
      );
      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, accountId, count: trends.length, trends });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── DOM Dump (selector tuning) ─────────────────────────────────────────
  // GET /api/dom-dump?url=…&account_id=…
  // Opens the URL via the account's logged-in browser, runs the heuristic
  // candidate sweep from dom-debug, and returns the dump as JSON. Used for
  // manual selector-tuning on the first live run — surface in the dashboard
  // as a "what does Vinted's DOM look like today?" inspector.
  app.get('/api/dom-dump', async (req, res) => {
    if (rejectIfLogin(res)) return;
    const url = (req.query.url as string | undefined)?.trim();
    if (!url) return res.status(400).json({ ok: false, error: 'url required' });
    // Only allow vinted.* origins — we don't want this becoming an open SSRF.
    try {
      const u = new URL(url);
      if (!/(^|\.)vinted\.[a-z.]+$/i.test(u.hostname)) {
        return res.status(400).json({ ok: false, error: 'url must be on a vinted.* domain' });
      }
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid url' });
    }
    let accountId: number;
    try {
      accountId = Number(req.query.account_id ?? req.query.account ?? getCurrentAccountId());
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw new Error(`Invalid account_id: ${req.query.account_id}`);
      }
      requireAccount(accountId);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const result = await vintedQueue.enqueue(async () => {
        const mb = await (await import('./browser.js')).getVintedBrowser(accountId);
        const page = await mb.context.newPage();
        try {
          // 30s overall budget — goto + waitForLoadState + sweep.
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => null);
          const { dumpDom } = await import('./dom-debug.js');
          const dump = await dumpDom(page);
          return dump;
        } finally {
          await page.close().catch(() => null);
        }
      }, `dom_dump_${accountId}`);
      res.json({ ok: true, accountId, url, dump: result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error });
    }
  });

  // ── Wallet (balance scrape + auto-payout) ─────────────────────────────
  // GET  /api/wallet/balance?account_id=X
  //   → { ok, accountId, balance: { balance_eur, pending_eur, iban_last4 } }
  // POST /api/wallet/payout body: { account_id, amount? }
  //   → { ok, requested_amount, error? }
  // Both routes are queued through vintedQueue so they don't collide with
  // listing/poll operations on the same browser context.
  app.get('/api/wallet/balance', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = Number(req.query.account_id ?? req.query.account ?? getCurrentAccountId());
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw new Error(`Invalid account_id: ${req.query.account_id}`);
      }
      requireAccount(accountId);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const runId = startBotRun('vinted', 'wallet_balance');
    const tracker = getSessionTracker(accountId);
    try {
      const { getWalletBalance } = await import('./wallet.js');
      const balance = await vintedQueue.enqueue(
        () => getWalletBalance(accountId),
        `wallet_balance_${accountId}`,
      );
      tracker.markValid();
      finishBotRun(runId, 'success');
      res.json({ ok: true, accountId, balance });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.post('/api/wallet/payout', async (req, res) => {
    if (rejectIfLogin(res)) return;
    let accountId: number;
    try {
      accountId = Number(req.body?.account_id ?? req.body?.accountId ?? getCurrentAccountId());
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw new Error(`Invalid account_id: ${req.body?.account_id}`);
      }
      requireAccount(accountId);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const rawAmount = req.body?.amount;
    const amount = rawAmount === undefined || rawAmount === null
      ? undefined
      : Number(rawAmount);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }
    const runId = startBotRun('vinted', 'wallet_payout');
    const tracker = getSessionTracker(accountId);
    try {
      const { requestPayout } = await import('./wallet.js');
      const result = await vintedQueue.enqueue(
        () => requestPayout(accountId, amount),
        `wallet_payout_${accountId}`,
      );
      if (result.ok) {
        tracker.markValid();
        finishBotRun(runId, 'success');
      } else {
        finishBotRun(runId, 'failure', result.error);
      }
      res.json({ ...result, accountId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      tracker.handleError(err);
      maybeAutoLogin(err, accountId);
      finishBotRun(runId, 'failure', error);
      res.status(500).json({ ok: false, error });
    }
  });

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    log.error('Unhandled API error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}
