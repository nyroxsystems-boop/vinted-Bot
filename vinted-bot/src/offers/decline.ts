import { createLogger, getDb, isBotBlocked } from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { markOfferDecided } from './evaluate.js';

const log = createLogger('vinted-decline');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

export async function declineOffer(
  offer: Offer,
  decidedBy: 'auto' | 'manual',
  accountId: number,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id FROM chats WHERE id = ?')
    .get(offer.chat_id) as { vinted_conversation_id: string } | undefined;
  if (!chat) return { ok: false, error: 'Chat not found' };

  const mb = await getVintedBrowser(accountId);
  const page = await mb.context.newPage();
  try {
    await requireLogin(page, accountId);
    await page.goto(`${BASE_URL}/inbox/${chat.vinted_conversation_id}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const block = await isBotBlocked(page);
    if (block.blocked) return { ok: false, error: `Blocked: ${block.reason}` };

    const btn = page.locator(VINTED.offerDeclineButton).first();
    if ((await btn.count()) === 0) {
      return { ok: false, error: 'Decline button not found' };
    }
    await btn.click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);

    markOfferDecided(offer.id, 'declined', decidedBy);
    log.info('Offer declined', { offerId: offer.id, decidedBy });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('declineOffer failed', { offerId: offer.id, error });
    return { ok: false, error };
  } finally {
    await page.close();
  }
}
