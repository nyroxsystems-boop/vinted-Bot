import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLiveEvents } from '../api/stream';

interface ChatRow {
  id: number;
  vinted_conversation_id: string;
  buyer_username: string;
  last_message_at: string | null;
  unread: number;
  message_count: number;
}

interface MessageRow {
  id: number;
  chat_id: number;
  direction: 'in' | 'out';
  body: string;
  is_offer: number;
  offer_amount_eur: number | null;
  created_at: string;
}

export function ChatsPage() {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  const loadChats = async () => {
    const rows = await api.get<ChatRow[]>('/chats');
    setChats(rows);
  };

  const loadMessages = async (chatId: number) => {
    const rows = await api.get<MessageRow[]>(`/chats/${chatId}/messages`);
    setMessages(rows);
  };

  useEffect(() => {
    void loadChats();
  }, []);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId]);

  useLiveEvents((e) => {
    if (e.type === 'message.new') {
      void loadChats();
      if (activeId) void loadMessages(activeId);
    }
  });

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      <div className="w-80 overflow-y-auto">
        <h1 className="mb-2 text-xl font-semibold">Chats</h1>
        <div className="space-y-1">
          {chats.length === 0 && <div className="text-sm text-slate-400">Noch keine Chats.</div>}
          {chats.map((c) => (
            <button
              key={c.id}
              className={`w-full rounded-md border p-3 text-left ${
                activeId === c.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
              onClick={() => setActiveId(c.id)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.buyer_username}</span>
                <span className="text-xs text-slate-400">{c.message_count}</span>
              </div>
              <div className="truncate text-xs text-slate-500">{c.last_message_at ?? '—'}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto card">
        {activeId === null ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            Chat auswählen
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[75%] rounded-lg p-2 text-sm ${
                  m.direction === 'in'
                    ? 'bg-slate-100'
                    : 'ml-auto bg-brand-500 text-white'
                }`}
              >
                <div>{m.body}</div>
                {m.is_offer === 1 && m.offer_amount_eur !== null && (
                  <div className="mt-1 text-xs opacity-75">
                    → Angebot erkannt: €{m.offer_amount_eur.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
