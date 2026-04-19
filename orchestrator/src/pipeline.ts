// ──────────────────────────────────────────────────────────────────────────────
// Pipeline (batch-cart mode):
//   • Vinted inbox polling (new messages + offers).
//   • Auto-accept offers that match min_accept_price.
//   • Poll paid sales (so the user sees them in the fulfillment queue).
//   • Poll Temu orders for tracking updates on batches the user has placed.
//
// Explicitly NOT done here:
//   • Automatic Temu orders. The user triggers a batch via the dashboard,
//     the bot adds to cart, and the user checks out on Temu manually.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  isPaused,
  evaluateOffer,
  loadPendingOffers,
} from '@vinted-system/shared';
import { vintedClient } from './bot-clients/vinted.js';
import { temuClient } from './bot-clients/temu.js';
import { eventBus } from './events.js';

const log = createLogger('pipeline');

export async function runPipelineCycle(): Promise<void> {
  if (isPaused()) {
    log.info('System paused — pipeline cycle skipped');
    return;
  }

  // 1. Inbox polling.
  try {
    const inbox = await vintedClient.pollInbox();
    if (inbox.result.newMessages > 0 || inbox.result.newOffers > 0) {
      log.info('Inbox polled', inbox.result);
    }
  } catch (err) {
    log.error('pollInbox failed', { error: errStr(err) });
    eventBus.publish({
      type: 'alert',
      level: 'error',
      message: `Vinted inbox poll failed: ${errStr(err)}`,
    });
  }

  // 2. Auto-evaluate pending offers.
  await processPendingOffers();

  // 3. Sales polling (so paid sales show up in the fulfillment queue).
  try {
    const sales = await vintedClient.pollSales();
    if (sales.result.updated > 0) log.info('Sales polled', sales.result);
  } catch (err) {
    log.error('pollSales failed', { error: errStr(err) });
  }

  // 4. Tracking for already-placed Temu batches.
  try {
    const res = await temuClient.pollOrders();
    if (res.result.updated > 0) log.info('Temu orders polled', res.result);
  } catch (err) {
    log.error('temu pollOrders failed', { error: errStr(err) });
  }
}

async function processPendingOffers(): Promise<void> {
  const pending = loadPendingOffers();
  for (const offer of pending) {
    const decision = evaluateOffer(offer);
    if (decision.action !== 'auto-accept') continue;

    log.info('Auto-accepting offer', { offerId: offer.id, reason: decision.reason });
    try {
      const res = await vintedClient.acceptOffer(offer.id, 'auto');
      if (res.ok) {
        eventBus.publish({
          type: 'offer.decided',
          offer: { ...offer, state: 'accepted', decided_by: 'auto', decided_at: nowIso() },
        });
      } else {
        log.warn('Auto-accept rejected by vinted-bot', { offerId: offer.id, error: res.error });
      }
    } catch (err) {
      log.error('acceptOffer failed', { offerId: offer.id, error: errStr(err) });
    }
  }
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nowIso(): string {
  return new Date().toISOString();
}
