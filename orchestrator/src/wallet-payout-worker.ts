// ──────────────────────────────────────────────────────────────────────────────
// Wallet-Payout Worker
//
// Once per week (configurable via `wallet_payout_interval_days`, default 7):
//   1. For each active Vinted account
//   2. GET `/api/wallet/balance?account_id=…` via vinted-bot
//   3. If balance >= `wallet_payout_threshold_eur` (default 50 EUR):
//        POST `/api/wallet/payout` with the full balance
//   4. Log result + emit a dashboard alert.
//
// Per-account payout-history is persisted in the `settings` table under
// `wallet_payout_history_<accountId>` (newest-first JSON array, capped at 50
// rows) so the dashboard can render a history without a new schema migration.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getSetting,
  setSetting,
  isPaused,
  withLock,
  markWorkerAlive,
  listActiveAccountsFor,
} from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('wallet-payout');
const VINTED_BOT_URL = process.env.VINTED_BOT_URL ?? 'http://localhost:4701';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Worker ticks every 6h but only fires payouts when (now - last-payout) >=
// configured interval-days. This makes interval changes apply on next tick
// without a restart.
const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_TICK_MS = 5 * 60 * 1000;

interface PayoutHistoryEntry {
  account_id: number;
  account_label?: string;
  requested_amount: number;
  ok: boolean;
  error?: string;
  at: string;          // ISO timestamp
}

function ensureSettings(): void {
  if (getSetting('wallet_payout_enabled') === null) setSetting('wallet_payout_enabled', 'true');
  if (getSetting('wallet_payout_interval_days') === null) setSetting('wallet_payout_interval_days', '7');
  if (getSetting('wallet_payout_threshold_eur') === null) setSetting('wallet_payout_threshold_eur', '50');
}

interface BalanceResponse {
  ok: boolean;
  balance?: { balance_eur: number; pending_eur: number; iban_last4: string | null };
  error?: string;
}

interface PayoutResponse {
  ok: boolean;
  requested_amount?: number;
  error?: string;
}

async function fetchBalance(accountId: number): Promise<{ balance_eur: number; iban_last4: string | null } | null> {
  try {
    const r = await fetch(`${VINTED_BOT_URL}/api/wallet/balance?account_id=${accountId}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      log.warn('Balance fetch non-2xx', { accountId, status: r.status });
      return null;
    }
    const j = (await r.json()) as BalanceResponse;
    if (!j.ok || !j.balance) return null;
    return { balance_eur: j.balance.balance_eur, iban_last4: j.balance.iban_last4 };
  } catch (err) {
    log.warn('Balance fetch failed', { accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function triggerPayout(accountId: number): Promise<PayoutResponse> {
  try {
    const r = await fetch(`${VINTED_BOT_URL}/api/wallet/payout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status}` };
    }
    return (await r.json()) as PayoutResponse;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function lastPayoutAt(accountId: number): Date | null {
  const v = getSetting(`wallet_payout_last_at_${accountId}`);
  if (!v) return null;
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function appendHistory(accountId: number, entry: PayoutHistoryEntry): void {
  const key = `wallet_payout_history_${accountId}`;
  let arr: PayoutHistoryEntry[] = [];
  try {
    const raw = getSetting(key);
    if (raw) arr = JSON.parse(raw) as PayoutHistoryEntry[];
    if (!Array.isArray(arr)) arr = [];
  } catch { arr = []; }
  arr.unshift(entry);
  arr = arr.slice(0, 50);
  setSetting(key, JSON.stringify(arr));
}

/** Read history for a single account — used by the wallet routes. */
export function getPayoutHistory(accountId: number): PayoutHistoryEntry[] {
  try {
    const raw = getSetting(`wallet_payout_history_${accountId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PayoutHistoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function tickOne(accountId: number, accountLabel: string, intervalDays: number, thresholdEur: number): Promise<void> {
  const last = lastPayoutAt(accountId);
  if (last) {
    const ageMs = Date.now() - last.getTime();
    if (ageMs < intervalDays * 24 * 60 * 60 * 1000) {
      log.debug('Skipping account — interval not yet reached', {
        accountId,
        ageDays: (ageMs / 86_400_000).toFixed(1),
        intervalDays,
      });
      return;
    }
  }

  const bal = await fetchBalance(accountId);
  if (!bal) {
    log.warn('Skipping account — balance not readable', { accountId });
    return;
  }
  if (bal.balance_eur < thresholdEur) {
    log.info('Skipping account — below threshold', {
      accountId,
      balance: bal.balance_eur,
      threshold: thresholdEur,
    });
    return;
  }

  log.info('Triggering payout', { accountId, balance: bal.balance_eur });
  const result = await triggerPayout(accountId);
  const entry: PayoutHistoryEntry = {
    account_id: accountId,
    account_label: accountLabel,
    requested_amount: result.requested_amount ?? bal.balance_eur,
    ok: !!result.ok,
    error: result.error,
    at: new Date().toISOString(),
  };
  appendHistory(accountId, entry);

  if (result.ok) {
    setSetting(`wallet_payout_last_at_${accountId}`, new Date().toISOString());
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `💰 ${entry.requested_amount.toFixed(2)} € Auto-Auszahlung für Account ${accountLabel}`,
    });
  } else {
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `⚠️ Auto-Auszahlung fehlgeschlagen für Account ${accountLabel}: ${result.error ?? 'unbekannter Fehler'}`,
    });
  }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  ensureSettings();
  if (getSetting('wallet_payout_enabled') !== 'true') {
    markWorkerAlive('wallet-payout');
    return;
  }
  isRunning = true;
  try {
    await withLock('wallet-payout-tick', 600, async () => {
      const intervalDays = Math.max(1, Number(getSetting('wallet_payout_interval_days') ?? '7'));
      const thresholdEur = Math.max(0, Number(getSetting('wallet_payout_threshold_eur') ?? '50'));
      const accounts = listActiveAccountsFor('vinted');
      if (accounts.length === 0) {
        log.info('No active Vinted accounts');
        return;
      }
      log.info('Wallet-payout tick', { accounts: accounts.length, intervalDays, thresholdEur });

      for (const acc of accounts) {
        try {
          await tickOne(acc.id, acc.label ?? `Account #${acc.id}`, intervalDays, thresholdEur);
        } catch (err) {
          log.error('Account payout tick failed', { accountId: acc.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    });
  } catch (err) {
    log.error('Wallet-payout tick crashed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

export function startWalletPayoutWorker(): void {
  if (timer) return;
  ensureSettings();
  log.info('Wallet-payout worker started', {
    enabled: getSetting('wallet_payout_enabled'),
    intervalDays: getSetting('wallet_payout_interval_days'),
    thresholdEur: getSetting('wallet_payout_threshold_eur'),
  });
  setTimeout(() => void tick(), FIRST_TICK_MS);
  timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
}

export function stopWalletPayoutWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Wallet-payout worker stopped');
  }
}

export const _internal = { tick, tickOne, fetchBalance, triggerPayout };
