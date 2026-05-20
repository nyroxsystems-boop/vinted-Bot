// ──────────────────────────────────────────────────────────────────────────────
// Vinted Wallet — balance scrape + auto-payout trigger.
//
// Two operations:
//
//   getWalletBalance(accountId) — navigate to /wallet, scrape the current
//     EUR balance + pending hold + last-4 IBAN digits. Best-effort; selectors
//     are guesses based on Vinted's profile-scraper conventions. Returns
//     0/0/null on scrape miss so the payout worker can decide to skip.
//
//   requestPayout(accountId, amount?) — navigate to /wallet, click the
//     "Geld abheben" button, fill the amount (defaults to full balance),
//     submit. CAPTCHA / bot-block detection runs before each interaction
//     so we never tap a button on an interstitial.
//
// Vinted's minimum payout threshold (typically 10 EUR) is enforced here:
// if balance < 10 we return `{ ok:false, error:'BALANCE_TOO_LOW' }` without
// even opening the page — saves a Playwright round-trip and avoids a
// guaranteed-failure click.
//
// TODO(selectors): the locators below are heuristic. Inspect the live
// /wallet DOM with a logged-in account and tighten them once observed.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  createLogger,
  requireAccount,
  isBotBlocked,
} from '@vinted-system/shared';
import { getVintedBrowser } from './browser.js';
import { requireLogin } from './auth.js';

const log = createLogger('vinted-wallet');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

// Vinted's hard floor for payouts. Override via env if the limit ever changes.
const MIN_PAYOUT_EUR = Number(process.env.VINTED_MIN_PAYOUT_EUR ?? '10');

export interface WalletBalance {
  balance_eur: number;
  pending_eur: number;
  iban_last4: string | null;
}

export interface PayoutResult {
  ok: boolean;
  requested_amount: number;
  error?: string;
}

/** Parse a German/English decimal like "142,80 €" or "$1.234,56". */
function parseEur(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).replace(/\s+/g, ' ').match(/([\d.,]+)/);
  if (!m || !m[1]) return null;
  // Treat dot as thousands separator only if it's not the last decimal mark.
  const tok = m[1];
  let cleaned: string;
  if (tok.includes(',') && tok.includes('.')) {
    // Both → dot=thousands, comma=decimal (de-DE)
    cleaned = tok.replace(/\./g, '').replace(',', '.');
  } else if (tok.includes(',')) {
    cleaned = tok.replace(',', '.');
  } else {
    cleaned = tok;
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Try several selectors; return inner text from the first visible one. */
async function tryText(page: Page, selectors: string[], timeoutMs = 1500): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible({ timeout: timeoutMs }).catch(() => false);
      if (!visible) continue;
      const txt = (await loc.innerText({ timeout: timeoutMs }).catch(() => '')).trim();
      if (txt) return txt;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Navigate to /wallet (with /balance / /member/wallet fallbacks). */
async function gotoWallet(page: Page): Promise<boolean> {
  const candidates = [
    `${BASE_URL}/wallet`,
    `${BASE_URL}/member/wallet`,
    `${BASE_URL}/balance`,
  ];
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => null);
      const u = page.url();
      if (/\/(404|login|signup)/i.test(u)) continue;
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Scrape balance + pending + last-4 IBAN. Returns 0/0/null on miss. */
export async function getWalletBalance(accountId: number): Promise<WalletBalance> {
  requireAccount(accountId);
  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  try {
    await requireLogin(page, accountId);
    const ok = await gotoWallet(page);
    if (!ok) {
      log.warn('Wallet page unreachable', { accountId });
      return { balance_eur: 0, pending_eur: 0, iban_last4: null };
    }

    const block = await isBotBlocked(page).catch(() => ({ blocked: false, reason: '' }));
    if (block.blocked) {
      log.warn('Bot-blocked on /wallet', { accountId, reason: block.reason });
      return { balance_eur: 0, pending_eur: 0, iban_last4: null };
    }

    // ── Balance ────────────────────────────────────────────────────────────
    // TODO(selectors): tune against live wallet DOM.
    const balanceText = await tryText(page, [
      '[data-testid="wallet-balance"]',
      '[data-testid="balance-amount"]',
      '[data-testid="wallet-amount"]',
      '[data-testid="available-balance"]',
      'h1:has-text("€")',
      'h2:has-text("€")',
    ], 3500);
    let balance = parseEur(balanceText) ?? 0;

    // Fallback: scrape body text for "Saldo: 12,34 €" or "Verfügbar: …"
    if (balance === 0) {
      const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      const m = body.match(/(?:Saldo|Verfügbar|Available|Balance|Guthaben)[^\d]{0,20}([\d.,]+)\s*€/i);
      if (m) balance = parseEur(m[1]) ?? 0;
    }

    // ── Pending ────────────────────────────────────────────────────────────
    const pendingText = await tryText(page, [
      '[data-testid="wallet-pending"]',
      '[data-testid="pending-balance"]',
      'text=/Ausstehend|Pending|Reserviert|on hold/i',
    ], 1500);
    let pending = parseEur(pendingText) ?? 0;
    if (pending === 0) {
      const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
      const m = body.match(/(?:Ausstehend|Reserviert|Pending|on hold)[^\d]{0,20}([\d.,]+)\s*€/i);
      if (m) pending = parseEur(m[1]) ?? 0;
    }

    // ── IBAN last-4 ────────────────────────────────────────────────────────
    const ibanText = await tryText(page, [
      '[data-testid="bank-account-iban"]',
      '[data-testid="wallet-iban"]',
      'text=/IBAN/i',
    ], 1500);
    let iban_last4: string | null = null;
    if (ibanText) {
      const m = ibanText.match(/[\d]{4}\s*$/);
      iban_last4 = m ? m[0].trim() : null;
    }

    log.info('Wallet balance scraped', { accountId, balance, pending, iban_last4 });
    return { balance_eur: balance, pending_eur: pending, iban_last4 };
  } finally {
    await page.close().catch(() => null);
  }
}

/** Click "Geld abheben", optionally fill an amount, submit. */
export async function requestPayout(accountId: number, amount_eur?: number): Promise<PayoutResult> {
  requireAccount(accountId);

  // Pre-flight: check balance to avoid wasted clicks for amounts below Vinted's
  // minimum payout threshold.
  const balance = await getWalletBalance(accountId);
  const requested = amount_eur ?? balance.balance_eur;

  if (balance.balance_eur < MIN_PAYOUT_EUR) {
    log.info('Skipping payout — balance below minimum', { accountId, balance: balance.balance_eur, min: MIN_PAYOUT_EUR });
    return { ok: false, requested_amount: requested, error: 'BALANCE_TOO_LOW' };
  }
  if (requested <= 0) {
    return { ok: false, requested_amount: requested, error: 'AMOUNT_INVALID' };
  }
  if (requested > balance.balance_eur) {
    return { ok: false, requested_amount: requested, error: 'AMOUNT_EXCEEDS_BALANCE' };
  }

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  try {
    await requireLogin(page, accountId);
    const opened = await gotoWallet(page);
    if (!opened) return { ok: false, requested_amount: requested, error: 'WALLET_PAGE_UNREACHABLE' };

    let block = await isBotBlocked(page).catch(() => ({ blocked: false, reason: '' }));
    if (block.blocked) return { ok: false, requested_amount: requested, error: `BLOCKED:${block.reason ?? 'unknown'}` };

    // ── Click "Geld abheben" / "Withdraw" / "Auszahlen" ───────────────────
    // TODO(selectors): tune against live wallet DOM. Vinted typically has a
    // CTA-styled button with one of these German/English labels.
    const withdrawBtn = page.locator([
      '[data-testid="withdraw-button"]',
      '[data-testid="payout-button"]',
      'button:has-text("Geld abheben")',
      'button:has-text("Auszahlen")',
      'a:has-text("Geld abheben")',
      'a:has-text("Auszahlen")',
      'button:has-text("Withdraw")',
    ].join(', ')).first();

    const visible = await withdrawBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) {
      log.warn('Withdraw button not found', { accountId });
      return { ok: false, requested_amount: requested, error: 'WITHDRAW_BUTTON_NOT_FOUND' };
    }
    await withdrawBtn.click({ timeout: 5_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => null);

    // Re-check for CAPTCHA after navigation.
    block = await isBotBlocked(page).catch(() => ({ blocked: false, reason: '' }));
    if (block.blocked) return { ok: false, requested_amount: requested, error: `BLOCKED:${block.reason ?? 'unknown'}` };

    // ── Fill the amount field if one exists ───────────────────────────────
    // Some flows auto-fill the full balance and only show a Confirm step,
    // in which case the input may not be present.
    const amountInput = page.locator([
      '[data-testid="payout-amount"]',
      '[data-testid="withdraw-amount"]',
      'input[name="amount"]',
      'input[type="number"]',
    ].join(', ')).first();
    const hasInput = await amountInput.isVisible({ timeout: 2_500 }).catch(() => false);
    if (hasInput) {
      // Vinted UI uses comma as decimal separator.
      const value = requested.toFixed(2).replace('.', ',');
      try {
        await amountInput.fill('');
        await page.waitForTimeout(200);
        await amountInput.fill(value);
      } catch (err) {
        log.warn('Amount fill failed (continuing)', { accountId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Submit ────────────────────────────────────────────────────────────
    const submitBtn = page.locator([
      '[data-testid="payout-submit"]',
      '[data-testid="withdraw-submit"]',
      'button:has-text("Bestätigen")',
      'button:has-text("Auszahlen")',
      'button:has-text("Confirm")',
      'button[type="submit"]',
    ].join(', ')).first();
    const subVisible = await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!subVisible) {
      return { ok: false, requested_amount: requested, error: 'SUBMIT_BUTTON_NOT_FOUND' };
    }
    await submitBtn.click({ timeout: 5_000 });
    await page.waitForTimeout(2_500);

    // Re-check post-submit. A success state usually navigates back to /wallet
    // with the balance cleared; a failure stays on the form with an error
    // banner. We treat absence-of-error as success.
    block = await isBotBlocked(page).catch(() => ({ blocked: false, reason: '' }));
    if (block.blocked) return { ok: false, requested_amount: requested, error: `BLOCKED_AFTER_SUBMIT:${block.reason ?? 'unknown'}` };

    const errBanner = await page.locator(
      '[role="alert"], [data-testid*="error" i], .error-banner, text=/Fehler|Error|Failed/i',
    ).first().innerText({ timeout: 1500 }).catch(() => '');
    if (errBanner && /fehler|error|failed/i.test(errBanner)) {
      log.warn('Payout banner reported error', { accountId, errBanner });
      return { ok: false, requested_amount: requested, error: `SITE_ERROR:${errBanner.slice(0, 120)}` };
    }

    log.info('Payout requested', { accountId, requested });
    return { ok: true, requested_amount: requested };
  } finally {
    await page.close().catch(() => null);
  }
}
