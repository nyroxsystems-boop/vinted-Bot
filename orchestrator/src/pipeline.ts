// ──────────────────────────────────────────────────────────────────────────────
// Pipeline — multi-account, CJ-fulfilled:
//   • For every ACTIVE Vinted account:
//       – Poll inbox (new messages + offers)
//       – Poll paid sales
//       – Evaluate pending offers
//   • CJ orders are placed by the cj-fulfillment worker (separate file).
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  isPaused,
  evaluateOffer,
  loadPendingOffers,
  listActiveAccounts,
} from '@vinted-system/shared';
import { vintedClient } from './bot-clients/vinted.js';
import { eventBus } from './events.js';

const log = createLogger('pipeline');

export async function runPipelineCycle(): Promise<void> {
  if (isPaused()) {
    log.info('System paused — pipeline cycle skipped');
    return;
  }

  const accounts = listActiveAccounts();
  if (accounts.length === 0) {
    log.warn('No active Vinted accounts — skipping cycle');
    return;
  }

  for (const acc of accounts) {
    // 1. Inbox polling.
    try {
      const inbox = await vintedClient.pollInbox(acc.id);
      if (inbox.result.newMessages > 0 || inbox.result.newOffers > 0) {
        log.info('Inbox polled', { accountId: acc.id, ...inbox.result });
      }
    } catch (err) {
      log.error('pollInbox failed', { accountId: acc.id, error: errStr(err) });
      eventBus.publish({
        type: 'alert',
        level: 'error',
        message: `Vinted inbox poll fehlgeschlagen (${acc.label}): ${errStr(err)}`,
      });
    }

    // 2. Sales polling.
    try {
      const sales = await vintedClient.pollSales(acc.id);
      if (sales.result.updated > 0) {
        log.info('Sales polled', { accountId: acc.id, ...sales.result });
      }
    } catch (err) {
      log.error('pollSales failed', { accountId: acc.id, error: errStr(err) });
    }
  }

  // 3. Offer evaluation — the function already reads per-offer context
  //    from the DB, so no per-account loop is needed here.
  await processPendingOffers();
}

async function processPendingOffers(): Promise<void> {
  const pending = loadPendingOffers();
  for (const offer of pending) {
    const decision = evaluateOffer(offer);

    switch (decision.action) {
      case 'auto-accept': {
        log.info('Auto-accepting offer', { offerId: offer.id, reason: decision.reason });
        try {
          const res = await vintedClient.acceptOffer(offer.id, 'auto');
          if (res.ok) {
            eventBus.publish({
              type: 'offer.decided',
              decision: 'accepted',
              amount: offer.amount_eur,
              listing: `Listing #${offer.listing_id ?? '?'}`,
              by: 'auto',
              offer: { ...offer, state: 'accepted', decided_by: 'auto', decided_at: nowIso() },
            });
          } else {
            log.warn('Auto-accept rejected by vinted-bot', { offerId: offer.id, error: res.error });
          }
        } catch (err) {
          log.error('acceptOffer failed', { offerId: offer.id, error: errStr(err) });
        }
        break;
      }

      case 'auto-counter': {
        log.info('Auto-counter offer', {
          offerId: offer.id,
          counterAmount: decision.counterAmount,
        });
        try {
          await vintedClient.sendMessage(offer.chat_id, decision.counterMessage);
          eventBus.publish({
            type: 'alert',
            level: 'warn',
            message: `💬 Counter-Angebot: €${decision.counterAmount.toFixed(2)} (Offer #${offer.id})`,
          });
        } catch (err) {
          log.error('auto-counter message failed', { offerId: offer.id, error: errStr(err) });
        }
        break;
      }

      case 'auto-decline': {
        log.info('Auto-declining lowball', { offerId: offer.id, reason: decision.reason });
        try {
          const res = await vintedClient.declineOffer(offer.id, 'auto');
          if (res.ok) {
            eventBus.publish({
              type: 'offer.decided',
              decision: 'declined',
              amount: offer.amount_eur,
              listing: `Listing #${offer.listing_id ?? '?'}`,
              by: 'auto',
              offer: { ...offer, state: 'declined', decided_by: 'auto', decided_at: nowIso() },
            });
          }
        } catch (err) {
          log.error('auto-decline failed', { offerId: offer.id, error: errStr(err) });
        }
        break;
      }

      case 'review': {
        eventBus.publish({
          type: 'alert',
          level: 'warn',
          message: `🔔 Manuelles Review nötig: Offer #${offer.id} — €${offer.amount_eur.toFixed(2)} (${decision.reason})`,
        });
        break;
      }
    }
  }
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nowIso(): string {
  return new Date().toISOString();
}
