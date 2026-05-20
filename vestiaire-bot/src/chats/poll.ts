// ──────────────────────────────────────────────────────────────────────────────
// Vestiaire Collective — inbox poll.
//
// Reads the /member/inbox conversation list, scrapes per-conversation buyer +
// last message. Returns a JSON array so the orchestrator can persist.
//
// Vestiaire is Cloudflare-protected — caller should run prewarm first.
// ──────────────────────────────────────────────────────────────────────────────
import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';
import {
  SEL_LOGGED_IN,
  SEL_INBOX_URL,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('vc-chats-poll');
const BASE_URL = 'https://www.vestiairecollective.com';

// Raw selectors (used here so we can call locator().nth() for iteration).
// TODO: validate — confirm Vestiaire inbox markup.
const CONV_LINK_SELECTORS = [
  'a[href*="/conversation/"]',
  'a[href*="/messages/"]',
  '[data-testid="conversation-item"]',
  '[class*="ConversationListItem" i]',
];

const MSG_BUBBLE_SELECTORS = [
  '[data-testid="message-bubble"]',
  '[class*="MessageBubble" i]',
  '[class*="message-item" i]',
];

export interface VcMessage {
  body: string;
  direction: 'in' | 'out';
  vcMessageId: string | null;
}

export interface VcConversation {
  conversationId: string;
  buyerUsername: string;
  lastSnippet: string;
  lastMessageAt: string | null;
  messages: VcMessage[];
}

export interface PollResult {
  ok: boolean;
  conversations: VcConversation[];
  error?: string;
}

function extractConvId(url: string): string | null {
  const m = url.match(/\/(?:conversation|messages)\/([^/?#]+)/);
  return m?.[1] ?? null;
}

async function firstWorkingLocator(page: Page, candidates: readonly string[]) {
  for (const sel of candidates) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) return { selector: sel, count };
    } catch { /* try next */ }
  }
  return null;
}

export async function pollVestiaireInbox(page: Page): Promise<PollResult> {
  try {
    if (!(await SEL_LOGGED_IN.exists(page))) {
      return { ok: false, conversations: [], error: 'not authenticated' };
    }
    await page.goto(`${BASE_URL}${SEL_INBOX_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    if (await SEL_BLOCKED.exists(page)) {
      return { ok: false, conversations: [], error: 'blocked' };
    }
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha on inbox — caller must solve');
      return { ok: false, conversations: [], error: 'captcha' };
    }

    const matched = await firstWorkingLocator(page, CONV_LINK_SELECTORS);
    if (!matched) {
      return { ok: true, conversations: [] };
    }
    const items = page.locator(matched.selector);
    const count = await items.count();
    const conversations: VcConversation[] = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      try {
        const link = items.nth(i);
        const href = await link.getAttribute('href').catch(() => null);
        const fullText = (await link.innerText({ timeout: 1500 }).catch(() => '')).trim();
        const lines = fullText.split('\n').map((s) => s.trim()).filter(Boolean);
        const buyer = lines[0] ?? 'unknown';
        const snippet = lines.slice(1).join(' ') || '';

        // Conversation ID — prefer href segment, else hashed text.
        const convId = (href && extractConvId(href))
          ?? `vc-${i}-${fullText.slice(0, 16).replace(/\W+/g, '')}`;

        // Open conversation to read messages.
        const target = href
          ? (href.startsWith('http') ? href : `${BASE_URL}${href}`)
          : null;
        const messages: VcMessage[] = [];
        if (target) {
          const msgPage = await page.context().newPage();
          try {
            await msgPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 25_000 });
            await msgPage.waitForTimeout(1200);
            const bubMatch = await firstWorkingLocator(msgPage, MSG_BUBBLE_SELECTORS);
            if (bubMatch) {
              const bubbles = msgPage.locator(bubMatch.selector);
              const bc = await bubbles.count();
              for (let j = 0; j < Math.min(bc, 100); j++) {
                const b = bubbles.nth(j);
                const text = (await b.innerText().catch(() => '')).trim();
                if (!text) continue;
                const cls = (await b.getAttribute('class').catch(() => '')) ?? '';
                const direction: 'in' | 'out' =
                  /\b(self|own|outgoing|sender|right)\b/i.test(cls) ? 'out' : 'in';
                const id = await b.getAttribute('data-message-id').catch(() => null);
                messages.push({ body: text, direction, vcMessageId: id });
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
