import { Router } from 'express';
import { getDb } from '@vinted-system/shared';
import type { Chat, ChatMessage } from '@vinted-system/shared';

export const chatsRouter = Router();

chatsRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
         FROM chats c
         ORDER BY c.last_message_at DESC NULLS LAST`,
    )
    .all() as (Chat & { message_count: number })[];
  res.json(rows);
});

chatsRouter.get('/:id/messages', (req, res) => {
  const chatId = Number.parseInt(req.params.id, 10);
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(chatId) as ChatMessage[];
  res.json(rows);
});
