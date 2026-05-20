// ──────────────────────────────────────────────────────────────────────────────
// Wallet routes (orchestrator-side)
//
// Thin proxy in front of vinted-bot's /api/wallet/* endpoints so the
// dashboard has a single backend (orchestrator) to talk to.
//
//   GET  /api/wallet/balance?account_id=X    → forward to vinted-bot
//   POST /api/wallet/payout body { account_id, amount? } → forward
//   GET  /api/wallet/history?account_id=X    → list auto-payouts from settings
//   GET  /api/wallet/settings                → current thresholds (read-only)
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getSetting, listActiveAccountsFor } from '@vinted-system/shared';
import { getPayoutHistory } from '../wallet-payout-worker.js';

const log = createLogger('routes:wallet');
const VINTED_BOT_URL = process.env.VINTED_BOT_URL ?? 'http://localhost:4701';

export const walletRouter = Router();

walletRouter.get('/balance', async (req, res) => {
  const accountId = Number(req.query.account_id ?? req.query.account ?? 0);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return res.status(400).json({ ok: false, error: 'account_id required' });
  }
  try {
    const r = await fetch(`${VINTED_BOT_URL}/api/wallet/balance?account_id=${accountId}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const body = await r.json().catch(() => ({ ok: false, error: 'invalid-json' }));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

walletRouter.post('/payout', async (req, res) => {
  const accountId = Number(req.body?.account_id ?? 0);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return res.status(400).json({ ok: false, error: 'account_id required' });
  }
  const amount = req.body?.amount;
  try {
    const r = await fetch(`${VINTED_BOT_URL}/api/wallet/payout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, amount }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await r.json().catch(() => ({ ok: false, error: 'invalid-json' }));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

walletRouter.get('/history', (req, res) => {
  const accountIdParam = Number(req.query.account_id ?? req.query.account ?? 0);
  try {
    if (Number.isFinite(accountIdParam) && accountIdParam > 0) {
      const history = getPayoutHistory(accountIdParam);
      return res.json({ ok: true, account_id: accountIdParam, history });
    }
    // No account specified → aggregate across all active Vinted accounts.
    const accounts = listActiveAccountsFor('vinted');
    const all = accounts.flatMap((a) =>
      getPayoutHistory(a.id).map((h) => ({ ...h, account_label: h.account_label ?? a.label })),
    ).sort((a, b) => b.at.localeCompare(a.at));
    res.json({ ok: true, history: all.slice(0, 100) });
  } catch (err) {
    log.error('History fetch failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

walletRouter.get('/settings', (_req, res) => {
  res.json({
    ok: true,
    settings: {
      enabled: getSetting('wallet_payout_enabled') === 'true',
      interval_days: Number(getSetting('wallet_payout_interval_days') ?? '7'),
      threshold_eur: Number(getSetting('wallet_payout_threshold_eur') ?? '50'),
    },
  });
});
