// REST-Routes für Depop-Chats — liest aus depop_*-Tabellen, sendet via Bot.
// Spiegelt /api/kleinanzeigen/* 1:1, damit die Chats-Page beide Marktplätze
// uniform laden kann.

import { Router } from 'express';
import { createLogger, getCurrentAccountId, getDb } from '@vinted-system/shared';

const log = createLogger('depop-route');
const DEPOP_BOT_URL = process.env.DEPOP_BOT_URL ?? 'http://localhost:4705';

export const depopRouter = Router();

// All chats
depopRouter.get('/chats', (_req, res) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM depop_messages m WHERE m.chat_id = c.id) AS message_count,
                (SELECT body      FROM depop_messages m WHERE m.chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_body,
                (SELECT direction FROM depop_messages m WHERE m.chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_direction,
                (SELECT COUNT(*)  FROM depop_messages m WHERE m.chat_id = c.id AND m.is_offer = 1 AND m.offer_state = 'pending') AS pending_offers
           FROM depop_chats c
           ORDER BY c.last_message_at DESC NULLS LAST`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Messages of a chat
depopRouter.get('/chats/:id/messages', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const rows = getDb()
      .prepare('SELECT * FROM depop_messages WHERE chat_id = ? ORDER BY created_at ASC')
      .all(id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Send a reply
depopRouter.post('/chats/:id/send', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const body = (req.body as { body?: string })?.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty body' });

    const chat = getDb()
      .prepare('SELECT depop_conversation_id, account_id FROM depop_chats WHERE id = ?')
      .get(id) as { depop_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ error: 'chat not found' });

    const r = await fetch(`${DEPOP_BOT_URL}/api/chats/${encodeURIComponent(chat.depop_conversation_id)}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: chat.account_id, body: body.trim() }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await r.json() as { ok: boolean; error?: string };

    if (result.ok) {
      getDb().prepare(
        `INSERT INTO depop_messages (chat_id, direction, body, is_offer) VALUES (?, 'out', ?, 0)`,
      ).run(id, body.trim());
      getDb().prepare(
        `UPDATE depop_chats SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(id);
    }
    res.json(result);
  } catch (e) {
    log.error('send failed', { err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Accept the most recent buyer offer in a chat
depopRouter.post('/chats/:id/offers/accept', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const chat = getDb()
      .prepare('SELECT depop_conversation_id, account_id FROM depop_chats WHERE id = ?')
      .get(id) as { depop_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ error: 'chat not found' });

    const r = await fetch(`${DEPOP_BOT_URL}/api/offers/${encodeURIComponent(chat.depop_conversation_id)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: chat.account_id }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await r.json() as { ok: boolean; error?: string };
    if (result.ok) {
      getDb().prepare(
        `UPDATE depop_messages SET offer_state = 'accepted'
          WHERE chat_id = ? AND is_offer = 1 AND offer_state = 'pending'`,
      ).run(id);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

depopRouter.post('/chats/:id/offers/decline', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    const chat = getDb()
      .prepare('SELECT depop_conversation_id, account_id FROM depop_chats WHERE id = ?')
      .get(id) as { depop_conversation_id: string; account_id: number } | undefined;
    if (!chat) return res.status(404).json({ error: 'chat not found' });

    const r = await fetch(`${DEPOP_BOT_URL}/api/offers/${encodeURIComponent(chat.depop_conversation_id)}/decline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: chat.account_id }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await r.json() as { ok: boolean; error?: string };
    if (result.ok) {
      getDb().prepare(
        `UPDATE depop_messages SET offer_state = 'declined'
          WHERE chat_id = ? AND is_offer = 1 AND offer_state = 'pending'`,
      ).run(id);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Manual inbox poll
depopRouter.post('/chats/poll', async (_req, res) => {
  try {
    const r = await fetch(`${DEPOP_BOT_URL}/api/chats/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: getCurrentAccountId() }),
      signal: AbortSignal.timeout(180_000),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Manual sold poll
depopRouter.post('/sold/poll', async (_req, res) => {
  try {
    const r = await fetch(`${DEPOP_BOT_URL}/api/sold/poll`, {
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

// Pending Autopilot-Drafts per Depop chat
depopRouter.get('/chats/:id/pending-replies', (req, res) => {
  try {
    const chatId = Number.parseInt(req.params.id ?? '', 10);
    const rows = getDb()
      .prepare(
        `SELECT id, intent, in_text, draft_text, mode, status, meta_json, created_at
           FROM reply_autopilot_log
          WHERE chat_id = ? AND marketplace = 'depop' AND status = 'pending'
          ORDER BY created_at DESC`,
      )
      .all(chatId);
    res.json({ chatId, drafts: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Mark chat read
depopRouter.post('/chats/:id/read', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    getDb().prepare('UPDATE depop_chats SET unread = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
