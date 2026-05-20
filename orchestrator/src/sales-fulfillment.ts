// ──────────────────────────────────────────────────────────────────────────────
// Sales-Fulfillment Worker
//
// Runs periodically and walks every paid sale through the full post-sale
// journey, so the user only has to pack the package. Steps per sale:
//
//   1. Shipping-label → download + store locally (so packing shows it).
//   2. Tracking-number → forward Temu tracking into the buyer's Vinted chat.
//   3. Feedback → leave a 5-star review with the configured template.
//
// Each step is guarded by a setting (`auto_fetch_shipping_label`,
// `auto_send_tracking_to_buyer`, `auto_leave_feedback`) so the user can
// disable any of them. A step that fails is retried on the next tick —
// the DB columns (shipping_label_path, tracking_sent_at, feedback_left_at)
// are the idempotency keys.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getDb, getSetting, isPaused } from '@vinted-system/shared';
import { vintedClient } from './bot-clients/vinted.js';
import { eventBus } from './events.js';

const log = createLogger('sales-fulfillment');

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const MAX_PER_CYCLE = 5;

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  isRunning = true;
  try {
    await runFetchLabels();
    await runSendTracking();
    await runLeaveFeedback();
  } catch (err) {
    log.error('Sales fulfillment crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

// ── 1. Label download ────────────────────────────────────────────────────────
async function runFetchLabels(): Promise<void> {
  if (getSetting('auto_fetch_shipping_label') !== 'true') return;
  const rows = getDb()
    .prepare(
      `SELECT id
         FROM sales
        WHERE paid_at IS NOT NULL
          AND shipping_label_path IS NULL
        ORDER BY paid_at ASC
        LIMIT ?`,
    )
    .all(MAX_PER_CYCLE) as Array<{ id: number }>;
  if (rows.length === 0) return;

  for (const { id } of rows) {
    try {
      const res = await vintedClient.downloadLabel(id);
      if (res.ok) {
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `📄 Label für Sale #${id} geladen — bereit zum Packen.`,
        });
      } else {
        log.info('Label fetch skipped', { saleId: id, error: res.error });
      }
    } catch (err) {
      log.warn('downloadLabel crashed', {
        saleId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── 2. Tracking → buyer chat ────────────────────────────────────────────────
async function runSendTracking(): Promise<void> {
  if (getSetting('auto_send_tracking_to_buyer') !== 'true') return;
  // Sales that have a tracking number (from Temu or CJ) but haven't messaged the buyer yet.
  const rows = getDb()
    .prepare(
      `SELECT s.id AS sale_id,
              COALESCE(s.tracking_number, c.tracking_number, t.tracking_number) AS tracking,
              l.title AS listing_title,
              o.chat_id AS chat_id
         FROM sales s
    LEFT JOIN cj_orders c ON c.sale_id = s.id
    LEFT JOIN temu_orders t ON t.sale_id = s.id
         JOIN listings l ON l.id = s.listing_id
    LEFT JOIN offers o ON o.id = s.offer_id
        WHERE s.tracking_sent_at IS NULL
          AND COALESCE(s.tracking_number, c.tracking_number, t.tracking_number) IS NOT NULL
          AND o.chat_id IS NOT NULL
        ORDER BY s.id ASC
        LIMIT ?`,
    )
    .all(MAX_PER_CYCLE) as Array<{
      sale_id: number;
      tracking: string;
      listing_title: string;
      chat_id: number;
    }>;

  if (rows.length === 0) return;

  for (const row of rows) {
    const message =
      `Hi! Dein Artikel "${row.listing_title}" ist unterwegs 📦\n` +
      `Sendungsnummer: ${row.tracking}\n\n` +
      `Bei Fragen einfach melden — bitte denk auch an eine Bewertung, wenn alles passt 💕`;
    try {
      await vintedClient.sendMessage(row.chat_id, message);
      getDb()
        .prepare(
          `UPDATE sales
              SET tracking_number = ?, tracking_sent_at = datetime('now')
            WHERE id = ?`,
        )
        .run(row.tracking, row.sale_id);
      log.info('Tracking sent to buyer', { saleId: row.sale_id });

      // Notify via Telegram
      eventBus.publish({
        type: 'tracking.sent',
        saleId: row.sale_id,
        tracking: row.tracking,
      });
    } catch (err) {
      log.warn('sendTracking failed', {
        saleId: row.sale_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── 3. Auto-feedback ────────────────────────────────────────────────────────
async function runLeaveFeedback(): Promise<void> {
  if (getSetting('auto_leave_feedback') !== 'true') return;
  // Sales that are shipped AND tracking was sent (so the buyer has had
  // time to receive + rate us). Vinted hides the feedback button until
  // after the buyer acts OR the grace period elapses, so it's fine to
  // retry aggressively — the bot skips silently when the button isn't
  // available yet.
  const rows = getDb()
    .prepare(
      `SELECT id
         FROM sales
        WHERE feedback_left_at IS NULL
          AND tracking_sent_at IS NOT NULL
          AND tracking_sent_at < datetime('now', '-24 hours')
        ORDER BY tracking_sent_at ASC
        LIMIT ?`,
    )
    .all(MAX_PER_CYCLE) as Array<{ id: number }>;
  if (rows.length === 0) return;

  for (const { id } of rows) {
    try {
      const res = await vintedClient.leaveFeedback(id);
      if (res.ok && !res.skipped) {
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `⭐ Feedback für Sale #${id} abgegeben.`,
        });
      }
    } catch (err) {
      log.warn('leaveFeedback crashed', {
        saleId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startSalesFulfillment(): void {
  if (timer) return;
  log.info('Sales fulfillment worker started', { intervalMs: POLL_INTERVAL_MS });
  setTimeout(() => void tick(), 30_000); // after bots boot
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopSalesFulfillment(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Sales fulfillment worker stopped');
  }
}
