// ──────────────────────────────────────────────────────────────────────────────
// Telegram Alert Worker
//
// Sends notifications for critical events:
//   - New sale (alert event with ✅)
//   - Bot errors
//   - Daily summary at 21:00
//
// Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env
// If not configured, silently no-ops.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb } from '@vinted-system/shared';
import type { SystemEvent } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('telegram-alerts');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

let isConfigured = false;
let dailySummaryTimer: ReturnType<typeof setInterval> | null = null;

export async function sendTelegram(message: string): Promise<boolean> {
  if (!isConfigured) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      log.warn('Telegram send failed', { status: resp.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('Telegram error', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// ── Event Listener ───────────────────────────────────────────────────────────

function setupEventListener(): void {
  eventBus.on('event', (event: SystemEvent) => {
    // Alert events (sales, publish success, batch alerts)
    if (event.type === 'alert') {
      void sendTelegram(`📢 ${event.message ?? 'System alert'}`);
    }

    // Offer received → instant push so user can decide
    if (event.type === 'offer.created') {
      const e = event as SystemEvent & { amount?: number; buyer?: string; listing?: string };
      void sendTelegram(
        `💰 <b>Neues Angebot!</b>\n` +
        `Käufer: ${e.buyer ?? '?'}\n` +
        `Betrag: €${(e.amount ?? 0).toFixed(2)}\n` +
        `Listing: ${e.listing ?? '?'}`,
      );
    }

    // Offer decided (auto or manual)
    if (event.type === 'offer.decided') {
      const e = event as SystemEvent & { decision?: string; amount?: number; listing?: string; by?: string };
      const icon = e.decision === 'accepted' ? '✅' : e.decision === 'declined' ? '❌' : '🔄';
      void sendTelegram(
        `${icon} Angebot ${e.decision ?? '?'} (€${(e.amount ?? 0).toFixed(2)})\n` +
        `Listing: ${e.listing ?? '?'}\n` +
        `Entschieden von: ${e.by ?? 'system'}`,
      );
    }

    // New sale — most critical event
    if (event.type === 'sale.created') {
      const e = event as SystemEvent & { amount?: number; buyer?: string; listing?: string };
      void sendTelegram(
        `🎉 <b>VERKAUF!</b> 🎉\n` +
        `€${(e.amount ?? 0).toFixed(2)} von ${e.buyer ?? '?'}\n` +
        `Listing: ${e.listing ?? '?'}\n\n` +
        `Jetzt Paket packen! 📦`,
      );
    }

    // Fulfillment tracking sent
    if (event.type === 'tracking.sent') {
      const e = event as SystemEvent & { saleId?: number; tracking?: string };
      void sendTelegram(`📬 Tracking an Käufer gesendet (Sale #${e.saleId ?? '?'}): ${e.tracking ?? '?'}`);
    }

    // Bot errors that need attention
    if (event.type === 'bot.error') {
      const e = event as SystemEvent & { bot?: string; error?: string };
      void sendTelegram(`🚨 <b>Bot-Fehler</b>: ${e.bot ?? '?'}\n${e.error ?? 'unknown'}`);
    }
  });
}

// ── Daily Summary ────────────────────────────────────────────────────────────

async function sendDailySummary(): Promise<void> {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Revenue = list_price_eur of sold listings today (sale price column doesn't
    // exist; list_price is a close-enough proxy since most sales close at listprice).
    const sales = db.prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(list_price_eur), 0) as revenue
       FROM listings WHERE status = 'sold' AND date(sold_at) = ?`
    ).get(today) as { cnt: number; revenue: number } | undefined;

    const published = db.prepare(
      `SELECT COUNT(*) as cnt FROM auto_listings
       WHERE status = 'published' AND date(updated_at) = ?`
    ).get(today) as { cnt: number } | undefined;

    const active = db.prepare(
      `SELECT COUNT(*) as cnt FROM marketplace_listings WHERE status = 'active'`
    ).get() as { cnt: number } | undefined;

    const msg = [
      `📊 <b>Tagesreport ${today}</b>`,
      ``,
      `💰 Verkäufe: ${sales?.cnt ?? 0} (€${(sales?.revenue ?? 0).toFixed(2)})`,
      `📤 Veröffentlicht: ${published?.cnt ?? 0} neue Listings`,
      `📦 Aktive Listings: ${active?.cnt ?? 0} auf allen Plattformen`,
    ].join('\n');

    await sendTelegram(msg);
    log.info('Daily summary sent');
  } catch (err) {
    log.warn('Daily summary failed', { error: String(err) });
  }
}

// ── Start/Stop ───────────────────────────────────────────────────────────────

export function startTelegramAlerts(): void {
  if (!BOT_TOKEN || !CHAT_ID) {
    log.info('Telegram alerts disabled — no BOT_TOKEN/CHAT_ID configured');
    return;
  }
  isConfigured = true;
  setupEventListener();

  // Daily summary at 21:00
  const now = new Date();
  const next2100 = new Date(now);
  next2100.setHours(21, 0, 0, 0);
  if (next2100 <= now) next2100.setDate(next2100.getDate() + 1);
  const msUntil2100 = next2100.getTime() - now.getTime();

  setTimeout(() => {
    void sendDailySummary();
    dailySummaryTimer = setInterval(() => void sendDailySummary(), 24 * 60 * 60 * 1000);
  }, msUntil2100);

  void sendTelegram('🟢 <b>Blackruby System gestartet</b> — alle Dienste aktiv');
  log.info('Telegram alerts started');
}

export function stopTelegramAlerts(): void {
  if (dailySummaryTimer) clearInterval(dailySummaryTimer);
  if (isConfigured) void sendTelegram('🔴 <b>Blackruby System heruntergefahren</b>');
}
