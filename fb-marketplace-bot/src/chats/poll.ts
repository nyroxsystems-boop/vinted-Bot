// ──────────────────────────────────────────────────────────────────────────────
// FB Marketplace — inbox poll.
//
// FB marketplace messages live under /marketplace/inbox. Markup is heavily
// obfuscated; we rely on stable aria-labels and href patterns.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_INBOX_URL,
  SEL_CHECKPOINT,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('fb-chats-poll');
const BASE_URL = 'https://www.facebook.com';

const CONV_LINK_SELECTORS = [
  'a[href*="/marketplace/t/"]',
  '[role="link"][aria-label*="Chat" i]',
  '[role="row"][aria-label*="Conversation" i]',
];

const MSG_BUBBLE_SELECTORS = [
  '[data-testid="mwthreadview-message"]',
  '[role="row"] [data-scope="messages_table"]',
  '[aria-label*="Message from" i]',
];

export interface FbMessage {
  body: string;
  direction: 'in' | 'out';
  fbMessageId: string | null;
}

export interface FbConversation {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastMessageAt: string | null;
  messages: FbMessage[];
}

export interface PollResult {
  ok: boolean;
  conversations: FbConversation[];
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

function extractConvId(href: string): string | null {
  // /marketplace/t/<id>/ or /messages/t/<id>/
  const m = href.match(/\/t\/([^/?#]+)/);
  return m?.[1] ?? null;
}

export async function pollFbInbox(page: Page): Promise<PollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, conversations: [], error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_INBOX_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3500); // long — FB React hydration is slow

    if (await SEL_CHECKPOINT.exists(page)) return { ok: false, conversations: [], error: 'FB checkpoint' };
    if (await SEL_CAPTCHA.exists(page)) return { ok: false, conversations: [], error: 'captcha' };

    const sel = await firstWorking(page, CONV_LINK_SELECTORS);
    if (!sel) return { ok: true, conversations: [] };

    const items = page.locator(sel);
    const count = await items.count();
    const conversations: FbConversation[] = [];

    for (let i = 0; i < Math.min(count, 25); i++) {
      try {
        const link = items.nth(i);
        const href = await link.getAttribute('href').catch(() => null);
        const aria = (await link.getAttribute('aria-label').catch(() => null)) ?? '';
        const fullText = (await link.innerText({ timeout: 1500 }).catch(() => '')).trim();
        const lines = fullText.split('\n').map((s) => s.trim()).filter(Boolean);
        const buyer = aria.split(',')[0]?.trim() || lines[0] || 'unknown';
        const snippet = lines.slice(1).join(' ') || aria;

        const convId = (href && extractConvId(href))
          ?? `fb-${i}-${(buyer + snippet).slice(0, 16).replace(/\W+/g, '')}`;

        const messages: FbMessage[] = [];
        if (href) {
          const target = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const msgPage = await page.context().newPage();
          try {
            await msgPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 25_000 });
            await msgPage.waitForTimeout(2500); // FB hydration
            const bSel = await firstWorking(msgPage, MSG_BUBBLE_SELECTORS);
            if (bSel) {
              const bubbles = msgPage.locator(bSel);
              const bc = await bubbles.count();
              for (let j = 0; j < Math.min(bc, 100); j++) {
                const b = bubbles.nth(j);
                const text = (await b.innerText().catch(() => '')).trim();
                if (!text) continue;
                const bAria = (await b.getAttribute('aria-label').catch(() => '')) ?? '';
                // "Message from <name>" → in; "Your message" or sent label → out
                const direction: 'in' | 'out' =
                  /your message|sent at|you said/i.test(bAria) ? 'out' : 'in';
                messages.push({ body: text, direction, fbMessageId: null });
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
