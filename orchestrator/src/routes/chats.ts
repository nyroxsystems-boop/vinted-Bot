import { Router } from 'express';
import { createLogger, getDb } from '@vinted-system/shared';
import type { Chat, ChatMessage } from '@vinted-system/shared';

const log = createLogger('chats-route');
const VINTED_BOT_URL = process.env.VINTED_BOT_URL ?? 'http://localhost:4701';

export const chatsRouter = Router();

/**
 * Parse the date that the KA-scraper concatenated to each message body.
 * Examples we see in the wild:
 *   "Hallo, habe ich beides. Lg :) 02.04.2026"  → 2026-04-02
 *   "Möchtest du noch was verkaufen? 16.05.2026" → 2026-05-16
 *   "Heute 14:30" / "Heute 2:51"                 → today at HH:MM
 *   "Gestern 09:15"                              → yesterday at HH:MM
 *
 * Returns an ISO string or null if no date could be parsed. The `scrapeRef`
 * is the row's stored created_at (= scrape time) — we anchor "Heute" /
 * "Gestern" against it so the parser stays correct after the fact.
 */
function parseMessageDate(body: string, scrapeRef: Date): string | null {
  // Pattern 1: explicit DD.MM.YYYY anywhere in the string.
  const explicit = body.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (explicit) {
    const [, d, m, y] = explicit;
    // Try to also grab a trailing HH:MM after it for finer ordering.
    const time = body.match(/(\d{1,2}):(\d{2})\s*$/);
    const iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}T` +
      (time ? `${time[1]!.padStart(2, '0')}:${time[2]}:00` : '12:00:00');
    return iso;
  }
  // Pattern 2: "Heute HH:MM"
  const today = body.match(/Heute\s+(\d{1,2}):(\d{2})/i);
  if (today) {
    const day = scrapeRef.toISOString().slice(0, 10);
    return `${day}T${today[1]!.padStart(2, '0')}:${today[2]}:00`;
  }
  // Pattern 3: "Gestern HH:MM"
  const yesterday = body.match(/Gestern\s+(\d{1,2}):(\d{2})/i);
  if (yesterday) {
    const d = new Date(scrapeRef);
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.toISOString().slice(0, 10);
    return `${day}T${yesterday[1]!.padStart(2, '0')}:${yesterday[2]}:00`;
  }
  return null;
}

/**
 * POST /api/chats/repair-dates
 *
 * One-shot data-repair: when the KA-scraper imports an old conversation it
 * stamps `last_message_at` and `created_at` with the SCRAPE time, not the
 * actual message time. So a chat from April that was scraped in May
 * appears at "19.05.2026" in the sidebar — even though the buyer hasn't
 * written in 6 weeks. This route walks every KA/Depop chat, parses the
 * date from the message body (KA suffixes the date into the text), and
 * updates `last_message_at` to the parsed value.
 *
 * Idempotent: re-running just re-derives the same dates.
 */
chatsRouter.post('/repair-dates', (_req, res) => {
  const db = getDb();
  const stats = { ka_scanned: 0, ka_updated: 0, depop_scanned: 0, depop_updated: 0 };

  const updateKa = db.prepare(`UPDATE kleinanzeigen_chats SET last_message_at = ? WHERE id = ?`);
  const kaChats = db.prepare(`SELECT id, last_message_at, created_at FROM kleinanzeigen_chats`).all() as Array<{ id: number; last_message_at: string | null; created_at: string }>;
  for (const c of kaChats) {
    stats.ka_scanned++;
    const msgs = db.prepare(`
      SELECT body, created_at FROM kleinanzeigen_messages
       WHERE chat_id = ? AND direction IN ('in','out')
       ORDER BY id ASC
    `).all(c.id) as Array<{ body: string; created_at: string }>;
    let latestParsed: string | null = null;
    for (const m of msgs) {
      const ref = new Date(m.created_at);
      const parsed = parseMessageDate(m.body, ref);
      if (parsed && (!latestParsed || parsed > latestParsed)) latestParsed = parsed;
    }
    if (latestParsed && latestParsed !== c.last_message_at) {
      updateKa.run(latestParsed, c.id);
      stats.ka_updated++;
    }
  }

  // Depop has its own table — same idea, less likely to need it but consistent.
  try {
    const updateDepop = db.prepare(`UPDATE depop_chats SET last_message_at = ? WHERE id = ?`);
    const depopChats = db.prepare(`SELECT id, last_message_at, created_at FROM depop_chats`).all() as Array<{ id: number; last_message_at: string | null; created_at: string }>;
    for (const c of depopChats) {
      stats.depop_scanned++;
      const msgs = db.prepare(`
        SELECT body, created_at FROM depop_messages
         WHERE chat_id = ? AND direction IN ('in','out')
         ORDER BY id ASC
      `).all(c.id) as Array<{ body: string; created_at: string }>;
      let latestParsed: string | null = null;
      for (const m of msgs) {
        const ref = new Date(m.created_at);
        const parsed = parseMessageDate(m.body, ref);
        if (parsed && (!latestParsed || parsed > latestParsed)) latestParsed = parsed;
      }
      if (latestParsed && latestParsed !== c.last_message_at) {
        updateDepop.run(latestParsed, c.id);
        stats.depop_updated++;
      }
    }
  } catch { /* depop tables may not exist on older DBs */ }

  log.info('chat date repair complete', stats);
  res.json({ ok: true, ...stats });
});

/**
 * GET /api/chats/unified?marketplace=all|vinted|kleinanzeigen
 * Returns chats from BOTH platforms in a normalized shape with a marketplace
 * field per row, sorted by last_message_at DESC. The UI uses this to show
 * one list with platform badges OR filter to a single marketplace.
 */
chatsRouter.get('/unified', (req, res) => {
  const mp = (req.query.marketplace as string | undefined) ?? 'all';
  interface Row {
    id: number;
    marketplace: 'vinted' | 'kleinanzeigen' | 'depop';
    buyer_username: string;
    last_message_at: string | null;
    unread: number;
    message_count: number;
    pending_drafts: number;
    ad_title?: string | null;
  }
  const out: Row[] = [];
  const db = getDb();
  if (mp === 'all' || mp === 'vinted') {
    const rows = db.prepare(`
      SELECT c.id, c.buyer_username, c.last_message_at, c.unread,
             (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
             (SELECT COUNT(*) FROM reply_autopilot_log r WHERE r.chat_id = c.id AND r.status = 'pending') AS pending_drafts
        FROM chats c
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 200
    `).all() as Array<{ id: number; buyer_username: string; last_message_at: string | null; unread: number; message_count: number; pending_drafts: number }>;
    for (const r of rows) out.push({ ...r, marketplace: 'vinted' });
  }
  if (mp === 'all' || mp === 'kleinanzeigen') {
    const rows = db.prepare(`
      SELECT c.id, c.buyer_username, c.last_message_at, c.unread, c.ad_title,
             (SELECT COUNT(*) FROM kleinanzeigen_messages m WHERE m.chat_id = c.id) AS message_count,
             0 AS pending_drafts
        FROM kleinanzeigen_chats c
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 200
    `).all() as Array<{ id: number; buyer_username: string; last_message_at: string | null; unread: number; ad_title: string | null; message_count: number; pending_drafts: number }>;
    for (const r of rows) out.push({ ...r, marketplace: 'kleinanzeigen' });
  }
  if (mp === 'all' || mp === 'depop') {
    // depop_chats only exists in newer schemas — wrap in try so the route
    // keeps working on stale databases that haven't run the latest migration.
    try {
      const rows = db.prepare(`
        SELECT c.id, c.buyer_username, c.last_message_at, c.unread, c.ad_title,
               (SELECT COUNT(*) FROM depop_messages m WHERE m.chat_id = c.id) AS message_count,
               (SELECT COUNT(*) FROM reply_autopilot_log r WHERE r.chat_id = c.id AND r.marketplace = 'depop' AND r.status = 'pending') AS pending_drafts
          FROM depop_chats c
         ORDER BY c.last_message_at DESC NULLS LAST
         LIMIT 200
      `).all() as Array<{ id: number; buyer_username: string; last_message_at: string | null; unread: number; ad_title: string | null; message_count: number; pending_drafts: number }>;
      for (const r of rows) out.push({ ...r, marketplace: 'depop' });
    } catch (err) {
      log.debug('depop_chats not in db yet — run migration', { err: err instanceof Error ? err.message : String(err) });
    }
  }
  out.sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  res.json(out);
});

chatsRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
              (SELECT COUNT(*) FROM reply_autopilot_log r
                WHERE r.chat_id = c.id AND r.status = 'pending') AS pending_drafts
         FROM chats c
         ORDER BY c.last_message_at DESC NULLS LAST`,
    )
    .all() as (Chat & { message_count: number; pending_drafts: number })[];
  res.json(rows);
});

chatsRouter.get('/:id/messages', (req, res) => {
  const chatId = Number.parseInt(req.params.id ?? '', 10);
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(chatId) as ChatMessage[];
  res.json(rows);
});

// Manuelle Antwort senden — geht über vinted-bot Endpoint
chatsRouter.post('/:id/send', async (req, res) => {
  try {
    const chatId = Number.parseInt(req.params.id ?? '', 10);
    const body = (req.body as { body?: string })?.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty body' });

    const chat = getDb()
      .prepare('SELECT vinted_conversation_id, account_id FROM chats WHERE id = ?')
      .get(chatId) as { vinted_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ error: 'chat not found' });

    const url = `${VINTED_BOT_URL}/chats/${chat.vinted_conversation_id}/send?account=${chat.account_id}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ ok: false, error: `vinted-bot ${r.status}: ${t.slice(0, 200)}` });
    }
    res.json(await r.json());
  } catch (err) {
    log.error('send failed', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Pending Autopilot-Drafts pro Chat
chatsRouter.get('/:id/pending-replies', (req, res) => {
  try {
    const chatId = Number.parseInt(req.params.id ?? '', 10);
    const rows = getDb()
      .prepare(
        `SELECT id, intent, in_text, draft_text, mode, status, meta_json, created_at
           FROM reply_autopilot_log
          WHERE chat_id = ? AND status = 'pending'
          ORDER BY created_at DESC`,
      )
      .all(chatId);
    res.json({ chatId, drafts: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Offer-Aktion innerhalb eines Chats (Accept/Decline)
chatsRouter.post('/:id/offer/:action', async (req, res) => {
  try {
    const chatId = Number.parseInt(req.params.id ?? '', 10);
    const action = req.params.action;
    if (action !== 'accept' && action !== 'decline') {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }
    // jüngstes pending offer in dem chat finden
    const offer = getDb()
      .prepare(
        `SELECT id FROM offers WHERE chat_id = ? AND state = 'pending' ORDER BY id DESC LIMIT 1`,
      )
      .get(chatId) as { id: number } | undefined;
    if (!offer) return res.status(404).json({ error: 'no pending offer in chat' });

    const url = `${VINTED_BOT_URL}/offers/${offer.id}/${action}`;
    const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(120_000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
