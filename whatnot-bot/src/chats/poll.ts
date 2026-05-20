// ──────────────────────────────────────────────────────────────────────────────
// Whatnot — DM inbox poll.
// Whatnot has direct messages (separate from live-chat). Best-effort scrape.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import { SEL_LOGGED_IN, SEL_INBOX_URL, SEL_BLOCKED, SEL_CAPTCHA } from '../selectors.js';

const log = createLogger('whatnot-chats-poll');
const BASE_URL = 'https://www.whatnot.com';

const CONV_LINK_SELECTORS = [
  'a[href*="/messages/"]',
  '[data-testid="conversation-item"]',
  '[class*="ConversationListItem" i]',
];

const MSG_BUBBLE_SELECTORS = [
  '[data-testid="message-bubble"]',
  '[class*="MessageBubble" i]',
  '[class*="message-item" i]',
];

export interface WnMessage {
  body: string;
  direction: 'in' | 'out';
  wnMessageId: string | null;
}

export interface WnConversation {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastMessageAt: string | null;
  messages: WnMessage[];
}

export interface PollResult {
  ok: boolean;
  conversations: WnConversation[];
  error?: string;
}

async function firstWorking(page: Page, candidates: readonly string[]) {
  for (const sel of candidates) {
    try {
      const c = await page.locator(sel).count();
      if (c > 0) return sel;
    } catch { /* try next */ }
  }
  return null;
}

export async function pollWhatnotInbox(page: Page): Promise<PollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, conversations: [], error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_INBOX_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    if (await SEL_BLOCKED.exists(page)) return { ok: false, conversations: [], error: 'blocked' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, conversations: [], error: 'captcha' };

    const sel = await firstWorking(page, CONV_LINK_SELECTORS);
    if (!sel) return { ok: true, conversations: [] };

    const items = page.locator(sel);
    const count = await items.count();
    const conversations: WnConversation[] = [];

    for (let i = 0; i < Math.min(count, 30); i++) {
      try {
        const link = items.nth(i);
        const href = await link.getAttribute('href').catch(() => null);
        const fullText = (await link.innerText({ timeout: 1500 }).catch(() => '')).trim();
        const lines = fullText.split('\n').map((s) => s.trim()).filter(Boolean);
        const buyer = lines[0] ?? 'unknown';
        const snippet = lines.slice(1).join(' ') || '';

        let convId: string;
        if (href) {
          const m = href.match(/\/messages\/([^/?#]+)/);
          convId = m?.[1] ?? `wn-${i}-${fullText.slice(0, 16).replace(/\W+/g, '')}`;
        } else {
          convId = `wn-${i}-${fullText.slice(0, 16).replace(/\W+/g, '')}`;
        }

        // Click into conversation to read messages.
        const messages: WnMessage[] = [];
        if (href) {
          const target = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const msgPage = await page.context().newPage();
          try {
            await msgPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 25_000 });
            await msgPage.waitForTimeout(1200);
            const bSel = await firstWorking(msgPage, MSG_BUBBLE_SELECTORS);
            if (bSel) {
              const bubbles = msgPage.locator(bSel);
              const bc = await bubbles.count();
              for (let j = 0; j < Math.min(bc, 100); j++) {
                const b = bubbles.nth(j);
                const text = (await b.innerText().catch(() => '')).trim();
                if (!text) continue;
                const cls = (await b.getAttribute('class').catch(() => '')) ?? '';
                const direction: 'in' | 'out' =
                  /\b(self|own|outgoing|sender|right)\b/i.test(cls) ? 'out' : 'in';
                messages.push({ body: text, direction, wnMessageId: null });
              }
            }
          } finally {
            await msgPage.close().catch(() => null);
          }
        }

        conversations.push({
          conversationId: convId,
          buyerUsername: buyer,
          lastSnippet: snippet,
          lastMessageAt: new Date().toISOString(),
          messages,
        });
      } catch (err) {
        log.warn('conv scrape failed', { idx: i, err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok: true, conversations };
  } catch (err) {
    return { ok: false, conversations: [], error: err instanceof Error ? err.message : String(err) };
  }
}
