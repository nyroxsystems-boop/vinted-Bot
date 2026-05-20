// ──────────────────────────────────────────────────────────────────────────────
// Grailed Offer — Accept the most recent buyer offer in a conversation.
//
// Flow:
//   1. Resolve chat → vinted_conversation_id (grailed:xxxx)
//   2. CF-safe navigate to /messages/{convId}
//   3. Click the Accept button. Grailed normally also shows a confirmation
//      modal — confirm it too.
//   4. Mark offer as accepted in DB + create a sales-shell row so the
//      orchestrator can hand off to fulfillment.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-offer-accept');

// TODO: validate selectors against live site.
const OFFER_ACCEPT_BUTTON = [
  'button:has-text("Accept offer")',
  'button:has-text("Accept")',
  'button[data-testid="accept-offer"]',
  'button[aria-label*="accept" i]',
].join(', ');

const CONFIRM_BUTTON = [
  'button:has-text("Confirm")',
  'button:has-text("Yes")',
  'button:has-text("Accept")',
  'button[data-testid="confirm"]',
].join(', ');

export async function acceptOffer(
  offer: Offer,
  decidedBy: 'auto' | 'manual',
  accountId: number,
): Promise<{ ok: boolean; saleId?: number; error?: string }> {
  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id, buyer_username FROM chats WHERE id = ?')
    .get(offer.chat_id) as { vinted_conversation_id: string; buyer_username: string } | undefined;
  if (!chat) return { ok: false, error: 'chat not found' };

  const conversationId = chat.vinted_conversation_id.startsWith('grailed:')
    ? chat.vinted_conversation_id.slice('grailed:'.length)
    : chat.vinted_conversation_id;

  const ctx = await launchGrailed(accountId, false);
  const page = await ctx.newPage();
  try {
    const home = await cloudflareSafeNavigate(page, GRAILED_BASE_URL, { timeoutMs: 25_000 });
    if (!home.ok) return { ok: false, error: home.error };
    if (!(await isGrailedLoggedIn(page))) {
      return { ok: false, error: 'not authenticated' };
    }

    const nav = await cloudflareSafeNavigate(
      page,
      `${GRAILED_BASE_URL}/messages/${conversationId}`,
      { timeoutMs: 25_000 },
    );
    if (!nav.ok) return { ok: false, error: nav.error };

    const btn = page.locator(OFFER_ACCEPT_BUTTON).first();
    if ((await btn.count()) === 0) {
      return { ok: false, error: 'accept button not found — offer may have expired' };
    }
    await btn.click({ timeout: 10_000 });

    // Confirmation modal (if any)
    const confirm = page.locator(CONFIRM_BUTTON).first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5_000 }).catch(() => null);
    }
    await page.waitForTimeout(2_000);

    // Mark in DB
    db.prepare(
      `UPDATE offers SET state = 'accepted', decided_by = ?, decided_at = datetime('now')
        WHERE id = ?`,
    ).run(decidedBy, offer.id);

    let saleId: number | undefined;
    if (offer.listing_id != null) {
      const res = db
        .prepare(
          `INSERT INTO sales (listing_id, offer_id, buyer_name)
           VALUES (?, ?, ?)`,
        )
        .run(offer.listing_id, offer.id, chat.buyer_username ?? 'unknown');
      saleId = res.lastInsertRowid as number;
    }

    log.info('Offer accepted', { offerId: offer.id, decidedBy, saleId });
    return { ok: true, saleId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Offer accept failed', { offerId: offer.id, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
