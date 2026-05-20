// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Postfach-Poll
//
// Liest die Postfach-Liste, öffnet jede Conversation, scrapet
// Käufer-Name + Inserat-Titel + alle Messages, schreibt in
// kleinanzeigen_chats / kleinanzeigen_messages.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger, getDb } from '@vinted-system/shared';
import { launchKaBrowser } from '../browser.js';
import { isLoggedIn } from '../login-flow.js';
import {
  SEL_CONV_LIST_ITEM,
  SEL_CONV_PARTNER_NAME,
  SEL_CONV_AD_TITLE,
  SEL_CONV_AD_LINK,
  SEL_MSG_BUBBLES,
  SEL_BLOCKED,
  SEL_CAPTCHA,
} from '../selectors.js';

const log = createLogger('ka-chats-poll');
// 2026 KA URL is /m-nachrichten.html (the old /m-postfach.html is 404).
const POSTFACH_URL = 'https://www.kleinanzeigen.de/m-nachrichten.html';

export interface PollStats {
  conversations: number;
  newMessages: number;
  errors: number;
}

interface ScrapedMessage {
  body: string;
  direction: 'in' | 'out';
  ka_message_id: string | null;
  ts: string | null;
}

interface ScrapedConversation {
  ka_conversation_id: string;
  url: string;
  buyer_username: string;
  ad_title: string | null;
  ad_url: string | null;
  messages: ScrapedMessage[];
  last_message_at: string | null;
}

function extractConversationId(url: string): string | null {
  // Beispiele:
  // /m-postfach-nachrichten.html?conversationId=abc123
  // /m-postfach-nachrichten.html?adId=...&conversationId=...
  const m = url.match(/conversationId=([^&]+)/);
  if (m) return m[1] ?? null;
  // Fallback: ganzer Pfad als ID
  return url.split('?').pop() ?? url;
}

async function scrapeConversation(page: Page, convUrl: string): Promise<ScrapedConversation | null> {
  try {
    await page.goto(convUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(800);

    // Käufer
    let buyer = 'Unbekannt';
    try {
      const t = await SEL_CONV_PARTNER_NAME.resolve(page);
      buyer = (await t.textContent())?.trim() || buyer;
    } catch { /* selectors drift */ }

    // Anzeige
    let adTitle: string | null = null;
    let adUrl: string | null = null;
    try {
      const t = await SEL_CONV_AD_TITLE.resolve(page);
      adTitle = (await t.textContent())?.trim() ?? null;
    } catch { /* */ }
    try {
      const a = await SEL_CONV_AD_LINK.resolve(page);
      const href = await a.getAttribute('href');
      if (href) adUrl = href.startsWith('http') ? href : `https://www.kleinanzeigen.de${href}`;
    } catch { /* */ }

    // Messages — wir lesen alle bubbles aus
    const bubbles = await page.locator(SEL_MSG_BUBBLES['name'] === 'ka:msg-bubbles' ? '[data-testid="message-item"], [class*="message-item" i], [role="article"]' : 'div').all().catch(() => []);
    const messages: ScrapedMessage[] = [];
    for (const b of bubbles) {
      try {
        const text = (await b.textContent())?.trim() ?? '';
        if (!text || text.length < 2) continue;
        // direction-Heuristik: wenn der Bubble-Container 'right' / 'self' / 'sender' im class hat → out
        const cls = (await b.getAttribute('class')) ?? '';
        const direction: 'in' | 'out' = /\b(self|own|right|sender|outgoing)\b/i.test(cls) ? 'out' : 'in';
        const id = (await b.getAttribute('data-id'))
          ?? (await b.getAttribute('data-message-id'))
          ?? null;
        messages.push({ body: text, direction, ka_message_id: id, ts: null });
      } catch { /* skip */ }
    }

    return {
      ka_conversation_id: extractConversationId(page.url()) ?? convUrl,
      url: page.url(),
      buyer_username: buyer,
      ad_title: adTitle,
      ad_url: adUrl,
      messages,
      last_message_at: messages.length > 0 ? new Date().toISOString() : null,
    };
  } catch (err) {
    log.warn('scrape conversation failed', { url: convUrl, err: String(err) });
    return null;
  }
}

function detectOffer(text: string): { isOffer: boolean; amount: number | null } {
  // Heuristik: Käufer schreibt z.B. "würde 20€ geben" oder "biete 18 EUR"
  const m = text.match(/(\d{1,4}(?:[\.,]\d{1,2})?)\s*(€|eur|euro)\b/i);
  if (m && /\b(biete|bieten|gibst|geben|nehmen|f[üu]r)\b/i.test(text)) {
    const v = parseFloat(m[1]!.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v < 10_000) return { isOffer: true, amount: v };
  }
  return { isOffer: false, amount: null };
}

function persist(accountId: number, conv: ScrapedConversation): number {
  const db = getDb();
  const tx = db.transaction(() => {
    // Upsert conversation
    db.prepare(
      `INSERT INTO kleinanzeigen_chats
         (account_id, ka_conversation_id, buyer_username, ad_title, ad_url, last_message_at, unread)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(ka_conversation_id) DO UPDATE SET
         buyer_username = excluded.buyer_username,
         ad_title = COALESCE(excluded.ad_title, kleinanzeigen_chats.ad_title),
         ad_url = COALESCE(excluded.ad_url, kleinanzeigen_chats.ad_url),
         last_message_at = excluded.last_message_at,
         updated_at = datetime('now')`,
    ).run(
      accountId,
      conv.ka_conversation_id,
      conv.buyer_username,
      conv.ad_title,
      conv.ad_url,
      conv.last_message_at,
    );
    const chatRow = db
      .prepare('SELECT id FROM kleinanzeigen_chats WHERE ka_conversation_id = ?')
      .get(conv.ka_conversation_id) as { id: number };

    // Insert messages — Dedup über ka_message_id (wenn vorhanden) oder body+direction
    let added = 0;
    for (const m of conv.messages) {
      // Skip if already exists (by ka_message_id OR identical body+direction in this chat)
      const exists = m.ka_message_id
        ? db.prepare('SELECT id FROM kleinanzeigen_messages WHERE ka_message_id = ?').get(m.ka_message_id)
        : db.prepare(
            `SELECT id FROM kleinanzeigen_messages
              WHERE chat_id = ? AND direction = ? AND body = ?
              LIMIT 1`,
          ).get(chatRow.id, m.direction, m.body);
      if (exists) continue;

      const offer = m.direction === 'in' ? detectOffer(m.body) : { isOffer: false, amount: null };
      db.prepare(
        `INSERT INTO kleinanzeigen_messages
           (chat_id, direction, body, is_offer, offer_amount_eur, ka_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      ).run(
        chatRow.id,
        m.direction,
        m.body,
        offer.isOffer ? 1 : 0,
        offer.amount,
        m.ka_message_id,
        m.ts ?? null,
      );
      added++;
    }
    return added;
  });
  return tx();
}

export async function pollKleinanzeigenInbox(accountId: number, dataRoot: string): Promise<PollStats> {
  const stats: PollStats = { conversations: 0, newMessages: 0, errors: 0 };
  const browser = await launchKaBrowser({
    accountId,
    storageDir: `${dataRoot}/${accountId}`,
    headless: true,
  });

  try {
    const page = await browser.context.newPage();
    if (!(await isLoggedIn(page))) {
      log.warn('Not authenticated — skipping poll', { accountId });
      await page.close();
      return stats;
    }

    await page.goto(POSTFACH_URL, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (await SEL_BLOCKED.exists(page)) {
      log.warn('blocked');
      await page.close();
      return stats;
    }
    if (await SEL_CAPTCHA.exists(page)) {
      log.warn('Captcha on KA postfach — attempting 2captcha solve');
      const { detectAndSolveCaptcha } = await import('@vinted-system/shared');
      const cap = await detectAndSolveCaptcha(page);
      if (!cap.solved) {
        log.warn('captcha unsolved — manual intervention required', { error: cap.error });
        await page.close();
        return stats;
      }
      log.info('Captcha solved on postfach');
      await page.waitForTimeout(2000);
    }
    // 2026 KA UI: conversations are <article class="ConversationListItem">
    // rendered by a JSX/React island, no <a> tag. Loading skeletons resolve
    // after a few seconds — wait for at least one item to be hydrated.
    await page.locator('article.ConversationListItem, article[class*="ConversationListItem"]')
      .first()
      .waitFor({ state: 'attached', timeout: 12_000 })
      .catch(() => null);
    await page.waitForTimeout(4000); // let all items hydrate

    // 2026 KA UI: SPA — click on a ConversationListItem renders the convo
    // in the RIGHT pane without URL change. We click, scrape the right pane,
    // and move to the next article (no goto needed between).
    const articleCount = await page.locator('article[class*="ConversationListItem"]').count();
    log.info('conversations found', { count: articleCount });

    for (let i = 0; i < articleCount; i++) {
      try {
        const arts = await page.locator('article[class*="ConversationListItem"]').all();
        const art = arts[i];
        if (!art) break;
        // Snapshot the article's text BEFORE clicking — used as unique ID since
        // KA doesn't expose conversation IDs in the DOM. Use innerText to preserve
        // line-break separators between name/date/title (textContent drops them).
        const articleText = (await art.evaluate((el) => (el as HTMLElement).innerText ?? '')).replace(/\n+/g, ' | ').replace(/\s{2,}/g, ' ').trim();
        await art.click({ timeout: 5_000 });
        await page.waitForTimeout(1500);

        // Scrape from the right pane
        const data = await page.evaluate(() => {
          // Right pane is identifiable by the MessageList component
          const msgList = document.querySelector('[class*="MessageList"]:not([class*="Loading"])');
          const msgs: Array<{ body: string; direction: 'in' | 'out'; ts: string | null }> = [];
          if (msgList) {
            const items = msgList.querySelectorAll('[class*="MessageListItem"]');
            items.forEach((el) => {
              const cls = el.className.toLowerCase();
              const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
              if (!text) return;
              const direction = cls.includes('outbound') || cls.includes('-self') || cls.includes('-own')
                ? 'out' as const : 'in' as const;
              // KA bubbles wrap the timestamp in <time datetime="…"> or as a
              // [datetime] attribute. Pick the first one we find inside this
              // message so we store the real send-time, not the scrape-time.
              const timeEl = el.querySelector('time[datetime], [datetime]');
              const ts = timeEl?.getAttribute('datetime') ?? null;
              msgs.push({ body: text, direction, ts });
            });
          }
          // Header in right pane often shows buyer + ad title
          const headerText = (document.querySelector('[class*="ConversationHeader" i], [class*="ConversationDetailHeader" i]') as HTMLElement | null)?.innerText ?? '';
          const adLink = document.querySelector('a[href*="/s-anzeige/"]') as HTMLAnchorElement | null;
          return {
            messages: msgs,
            headerText,
            adTitle: adLink?.textContent?.trim() ?? null,
            adUrl: adLink?.href ?? null,
          };
        });

        // articleText layout (innerText with line breaks → " | " separator):
        //   "[Anzeige gelöscht | ] Buyer | Datum | Ad-Title | last-message preview"
        // First non-meta segment = buyer name.
        const parts = articleText.split('|').map(s => s.trim()).filter(Boolean);
        const buyer = (parts.find(p => p !== 'Anzeige gelöscht' && !/\d/.test(p.slice(0, 2)) && p.length < 40) ?? 'Unbekannt');
        const adTitleFromList = parts.slice(1).find(p => p.length > 10 && p !== 'Anzeige gelöscht' && !/^heute|gestern|\d{2}\.\d{2}\./i.test(p));
        // Stable per-conversation ID: hash the article text (until KA exposes a real id)
        const convId = `ka-art-${i}-${articleText.slice(0, 32).replace(/\W+/g, '')}`;

        if (data.messages.length > 0) {
          stats.conversations++;
          const mappedMsgs = data.messages.map(m => ({
            body: m.body,
            direction: m.direction,
            ka_message_id: null,
            ts: m.ts ?? null,
          }));
          // Prefer the real timestamp of the last message; fall back to now
          // only when KA's DOM didn't expose a <time datetime> for any bubble.
          const lastTs = mappedMsgs.length > 0 ? mappedMsgs[mappedMsgs.length - 1]!.ts : null;
          const added = persist(accountId, {
            ka_conversation_id: convId,
            url: page.url(),
            buyer_username: buyer,
            ad_title: data.adTitle ?? adTitleFromList ?? null,
            ad_url: data.adUrl,
            messages: mappedMsgs,
            last_message_at: lastTs ?? new Date().toISOString(),
          });
          stats.newMessages += added;
        }
        await page.waitForTimeout(700);  // politeness
      } catch (err) {
        log.warn('conversation iteration failed', { idx: i, err: err instanceof Error ? err.message : String(err) });
        stats.errors++;
      }
    }

    await page.close();
    return stats;
  } finally {
    await browser.close();
  }
}
