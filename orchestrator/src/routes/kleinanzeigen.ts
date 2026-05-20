// REST-Routes für Kleinanzeigen-Chats — liest aus KA-Tabellen, sendet via Bot.
import { Router } from 'express';
import { createLogger, getCurrentAccountId, getDb } from '@vinted-system/shared';

const log = createLogger('ka-route');
const KA_BOT_URL = process.env.KLEINANZEIGEN_BOT_URL ?? 'http://localhost:4703';

export const kleinanzeigenRouter = Router();

// Liste aller KA-Chats
kleinanzeigenRouter.get('/chats', (_req, res) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM kleinanzeigen_messages m WHERE m.chat_id = c.id) AS message_count,
                (SELECT body FROM kleinanzeigen_messages m WHERE m.chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_body,
                (SELECT direction FROM kleinanzeigen_messages m WHERE m.chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_direction
           FROM kleinanzeigen_chats c
           ORDER BY c.last_message_at DESC NULLS LAST`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Messages eines Chats
kleinanzeigenRouter.get('/chats/:id/messages', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const rows = getDb()
      .prepare('SELECT * FROM kleinanzeigen_messages WHERE chat_id = ? ORDER BY created_at ASC')
      .all(id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Antworten — Proxy an Bot
kleinanzeigenRouter.post('/chats/:id/send', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const body = (req.body as { body?: string })?.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty body' });

    const chat = getDb()
      .prepare('SELECT ka_conversation_id, account_id FROM kleinanzeigen_chats WHERE id = ?')
      .get(id) as { ka_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ error: 'chat not found' });

    const r = await fetch(`${KA_BOT_URL}/api/chats/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: chat.account_id,
        conversation_id: chat.ka_conversation_id,
        body: body.trim(),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await r.json() as { ok: boolean; error?: string };

    // Bei Erfolg: out-Message lokal eintragen (sonst sehen wir's erst beim nächsten Poll)
    if (result.ok) {
      getDb().prepare(
        `INSERT INTO kleinanzeigen_messages (chat_id, direction, body, is_offer)
         VALUES (?, 'out', ?, 0)`,
      ).run(id, body.trim());
      getDb().prepare(
        `UPDATE kleinanzeigen_chats SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(id);
    }
    res.json(result);
  } catch (e) {
    log.error('send failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Manueller Inbox-Poll trigger
kleinanzeigenRouter.post('/chats/poll', async (_req, res) => {
  try {
    const r = await fetch(`${KA_BOT_URL}/api/chats/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: getCurrentAccountId() }),
      signal: AbortSignal.timeout(120_000),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pending Autopilot-Drafts pro KA-Chat
kleinanzeigenRouter.get('/chats/:id/pending-replies', (req, res) => {
  try {
    const chatId = Number.parseInt(req.params.id ?? '', 10);
    const rows = getDb()
      .prepare(
        `SELECT id, intent, in_text, draft_text, mode, status, meta_json, created_at
           FROM reply_autopilot_log
          WHERE chat_id = ? AND marketplace = 'kleinanzeigen' AND status = 'pending'
          ORDER BY created_at DESC`,
      )
      .all(chatId);
    res.json({ chatId, drafts: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Mark als gelesen
kleinanzeigenRouter.post('/chats/:id/read', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    getDb().prepare('UPDATE kleinanzeigen_chats SET unread = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
