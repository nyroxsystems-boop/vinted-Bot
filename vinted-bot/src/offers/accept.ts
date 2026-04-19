import { createLogger, getDb, isBotBlocked } from '@vinted-system/shared';
import type { Offer } from '@vinted-system/shared';
import { VINTED } from '../selectors.js';
import { getVintedBrowser } from '../browser.js';
import { requireLogin } from '../auth.js';
import { markOfferDecided } from './evaluate.js';

const log = createLogger('vinted-accept');
const BASE_URL = process.env.VINTED_BASE_URL ?? 'https://www.vinted.de';

/**
 * Click the "Accept offer" button inside the Vinted chat. Creates a sale row
 * on success so the orchestrator can hand off to the Temu bot.
 */
export async function acceptOffer(offer: Offer, decidedBy: 'auto' | 'manual'): Promise<{
  ok: boolean;
  saleId?: number;
  error?: string;
}> {
  const db = getDb();
  const chat = db
    .prepare('SELECT vinted_conversation_id FROM chats WHERE id = ?')
    .get(offer.chat_id) as { vinted_conversation_id: string } | undefined;
  if (!chat) return { ok: false, error: 'Chat not found' };

  if (offer.listing_id === null) {
    return { ok: false, error: 'Cannot accept offer without linked listing' };
  }

  const mb = await getVintedBrowser();
  const page = await mb.context.newPage();
  try {
    await requireLogin(page);
    await page.goto(`${BASE_URL}/inbox/${chat.vinted_conversation_id}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const block = await isBotBlocked(page);
    if (block.blocked) return { ok: false, error: `Blocked: ${block.reason}` };

    const btn = page.locator(VINTED.offerAcceptButton).first();
    if ((await btn.count()) === 0) {
      return { ok: false, error: 'Accept button not found — offer may have expired' };
    }

    await btn.click({ timeout: 10_000 });
    // Confirmation dialog — if present, confirm it too.
    const confirm = page.locator('button:has-text("Bestätigen"), button:has-text("Confirm")').first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5_000 }).catch(() => {
        /* non-fatal if no dialog */
      });
    }

    // Wait briefly for Vinted to process the accept.
    await page.waitForTimeout(2_000);

    markOfferDecided(offer.id, 'accepted', decidedBy);
    const saleId = createSaleRow(offer);
    log.info('Offer accepted', { offerId: offer.id, saleId, decidedBy });
    return { ok: true, saleId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('acceptOffer failed', { offerId: offer.id, error });
    return { ok: false, error };
  } finally {
    await page.close();
  }
}

function createSaleRow(offer: Offer): number {
  const db = getDb();
  const chat = db
    .prepare('SELECT buyer_username FROM chats WHERE id = ?')
    .get(offer.chat_id) as { buyer_username: string } | undefined;
  const res = db
    .prepare(
      `INSERT INTO sales (listing_id, offer_id, buyer_name)
       VALUES (?, ?, ?)`,
    )
    .run(offer.listing_id, offer.id, chat?.buyer_username ?? 'unknown');
  return res.lastInsertRowid as number;
}
