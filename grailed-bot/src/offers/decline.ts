// ──────────────────────────────────────────────────────────────────────────────
// Grailed Offer — Decline the most recent buyer offer in a conversation.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  getDb,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { launchGrailed, isGrailedLoggedIn, GRAILED_BASE_URL } from '../browser.js';

const log = createLogger('grailed-offer-decline');

// TODO: validate selectors against live site.
const OFFER_DECLINE_BUTTON = [
  'button:has-text("Decline offer")',
  'button:has-text("Decline")',
  'button:has-text("Reject")',
  'button[data-testid="decline-offer"]',
  'button[aria-label*="decline" i]',
].join(', ');

const CONFIRM_BUTTON = [
  'button:has-text("Confirm")',
  'button:has-text("Yes")',
  'button:has-text("Decline")',
  'button[data-testid="confirm"]',
].join(', ');

export async function declineOffer(
  offer: Offer,
  decidedBy: 'auto' | 'manual',
  accountId: number,
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id FROM chats WHERE id = ?')
    .get(offer.chat_id) as { vinted_conversation_id: string } | undefined;
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

    const btn = page.locator(OFFER_DECLINE_BUTTON).first();
    if ((await btn.count()) === 0) {
      return { ok: false, error: 'decline button not found' };
    }
    await btn.click({ timeout: 10_000 });

    const confirm = page.locator(CONFIRM_BUTTON).first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5_000 }).catch(() => null);
    }
    await page.waitForTimeout(1_500);

    db.prepare(
      `UPDATE offers SET state = 'declined', decided_by = ?, decided_at = datetime('now')
        WHERE id = ?`,
    ).run(decidedBy, offer.id);

    log.info('Offer declined', { offerId: offer.id, decidedBy });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Offer decline failed', { offerId: offer.id, error });
    return { ok: false, error };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}
