// ──────────────────────────────────────────────────────────────────────────────
// Depop Chat — reply send + offer accept/decline
// ──────────────────────────────────────────────────────────────────────────────

import type { BrowserContext } from 'playwright';
import {
  createLogger,
  cloudflareSafeNavigate,
} from '@vinted-system/shared';
import { humanType } from '@vinted-system/shared';
import {
  SEL_CHAT_REPLY_BOX,
  SEL_CHAT_SEND_BTN,
  SEL_OFFER_ACCEPT,
  SEL_OFFER_DECLINE,
} from '../selectors.js';

const log = createLogger('depop-chats-send');
const BASE = 'https://www.depop.com';

function convUrl(conversationId: string): string {
  return `${BASE}/messages/${conversationId}`;
}

/** Send a free-text reply into a conversation. */
export async function sendDepopMessage(
  ctx: BrowserContext,
  conversationId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!body.trim()) return { ok: false, error: 'empty body' };
  const page = await ctx.newPage();
  try {
    const nav = await cloudflareSafeNavigate(page, convUrl(conversationId), { timeoutMs: 25_000 });
    if (!nav.ok) return { ok: false, error: nav.error };

    const box = await SEL_CHAT_REPLY_BOX.resolve(page);
    await box.click();
    await humanType(page, box, body, { typos: false });
    await page.waitForTimeout(350);

    try {
      await SEL_CHAT_SEND_BTN.click(page);
    } catch {
      // Fallback — many chat UIs send on Enter
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(900);
    log.info('Reply sent', { conversationId, chars: body.length });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}

/** Accept the most recent buyer offer in a conversation. */
export async function acceptDepopOffer(
  ctx: BrowserContext,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const page = await ctx.newPage();
  try {
    const nav = await cloudflareSafeNavigate(page, convUrl(conversationId), { timeoutMs: 25_000 });
    if (!nav.ok) return { ok: false, error: nav.error };

    await SEL_OFFER_ACCEPT.click(page);
    await page.waitForTimeout(900);
    log.info('Offer accepted', { conversationId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}

/** Decline the most recent buyer offer in a conversation. */
export async function declineDepopOffer(
  ctx: BrowserContext,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const page = await ctx.newPage();
  try {
    const nav = await cloudflareSafeNavigate(page, convUrl(conversationId), { timeoutMs: 25_000 });
    if (!nav.ok) return { ok: false, error: nav.error };

    await SEL_OFFER_DECLINE.click(page);
    await page.waitForTimeout(900);
    log.info('Offer declined', { conversationId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}
