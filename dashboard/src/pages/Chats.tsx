import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { useLiveEvents } from '../api/stream';
import { useMarketplace } from '../components/MarketplaceContext';
import { fmtEur } from '../lib/format';
import { toast } from '../components/Toast';
import { MarketplaceBadge } from '../components/MarketplaceBadge';

interface ChatRow {
  id: number;
  marketplace?: 'vinted' | 'kleinanzeigen' | 'depop';
  vinted_conversation_id?: string;
  buyer_username: string;
  last_message_at: string | null;
  unread: number;
  message_count: number;
  pending_drafts: number;
  ad_title?: string | null;
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

interface PendingDraft {
  id: number;
  intent: string;
  in_text: string;
  draft_text: string;
  mode: string;
  status: string;
  meta_json: string | null;
  created_at: string;
}

type MpFilter = 'all' | 'vinted' | 'kleinanzeigen' | 'depop';

const FILTER_OPTIONS: Array<{ id: MpFilter; label: string }> = [
  { id: 'all',           label: 'Alle' },
  { id: 'vinted',        label: 'Vinted' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen' },
  { id: 'depop',         label: 'Depop' },
];

export function ChatsPage() {
  const { marketplace } = useMarketplace();
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeMp, setActiveMp] = useState<'vinted' | 'kleinanzeigen' | 'depop'>('vinted');
  // In-page marketplace filter — sticky in localStorage so the user's choice
  // survives page reloads. Layered ON TOP of the global MarketplaceContext
  // so the user can drill into "just Kleinanzeigen" without changing the
  // overall app marketplace.
  const [mpFilter, setMpFilter] = useState<MpFilter>(() => {
    try {
      const v = localStorage.getItem('br_chats_mp_filter');
      if (v && ['all','vinted','kleinanzeigen','depop'].includes(v)) return v as MpFilter;
    } catch { /* ignore */ }
    return 'all';
  });
  useEffect(() => {
    try { localStorage.setItem('br_chats_mp_filter', mpFilter); } catch { /* ignore */ }
  }, [mpFilter]);
  const [repairing, setRepairing] = useState(false);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editDraftId, setEditDraftId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadChats = useCallback(async () => {
    try {
      // In-page filter overrides the global marketplace context when set to
      // a specific platform; "all" falls back to the global setting.
      const mpParam =
        mpFilter !== 'all' ? mpFilter :
        marketplace === 'ebay_de' ? 'all' :
        marketplace;
      const rows = await api.get<ChatRow[]>(`/chats/unified?marketplace=${mpParam}`);
      setChats(rows);
    } catch (e) { console.error(e); }
  }, [marketplace, mpFilter]);

  const repairDates = async (): Promise<void> => {
    setRepairing(true);
    try {
      const result = await api.post<{ ok: boolean; ka_updated: number; ka_scanned: number; depop_updated: number; depop_scanned: number }>(
        '/chats/repair-dates',
      );
      toast.success(
        `Daten repariert`,
        { detail: `KA: ${result.ka_updated}/${result.ka_scanned} · Depop: ${result.depop_updated}/${result.depop_scanned}` },
      );
      await loadChats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  const loadMessages = async (chatId: number, mp: 'vinted' | 'kleinanzeigen' | 'depop') => {
    try {
      const base =
        mp === 'kleinanzeigen' ? `/kleinanzeigen/chats/${chatId}/messages` :
        mp === 'depop'         ? `/depop/chats/${chatId}/messages` :
                                 `/chats/${chatId}/messages`;
      const rows = await api.get<MessageRow[]>(base);
      setMessages(rows);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 50);
    } catch (e) { console.error(e); }
  };

  const loadDrafts = async (chatId: number, mp: 'vinted' | 'kleinanzeigen' | 'depop') => {
    if (mp === 'vinted') {
      try {
        const r = await api.get<{ drafts: PendingDraft[] }>(`/chats/${chatId}/pending-replies`);
        setDrafts(r.drafts);
      } catch (e) { console.error(e); setDrafts([]); }
      return;
    }
    if (mp === 'depop') {
      try {
        const r = await api.get<{ drafts: PendingDraft[] }>(`/depop/chats/${chatId}/pending-replies`);
        setDrafts(r.drafts);
      } catch (e) { console.error(e); setDrafts([]); }
      return;
    }
    setDrafts([]); // KA has no draft pipeline yet
  };

  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => {
    if (activeId !== null) {
      void loadMessages(activeId, activeMp);
      void loadDrafts(activeId, activeMp);
    }
  }, [activeId, activeMp]);

  useLiveEvents((e) => {
    if (e.type === 'message.new') {
      void loadChats();
      if (activeId !== null) {
        void loadMessages(activeId, activeMp);
        void loadDrafts(activeId, activeMp);
      }
    }
  });

  const send = async () => {
    if (!reply.trim() || activeId === null) return;
    setSending(true);
    try {
      const base =
        activeMp === 'kleinanzeigen' ? `/kleinanzeigen/chats/${activeId}/send` :
        activeMp === 'depop'         ? `/depop/chats/${activeId}/send` :
                                       `/chats/${activeId}/send`;
      await api.post(base, { body: reply.trim() });
      setReply('');
      await loadMessages(activeId, activeMp);
      await loadChats();
      setActionMsg('Gesendet');
      setTimeout(() => setActionMsg(null), 3000);
    } catch (e) {
      setActionMsg(`${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setActionMsg(null), 6000);
    } finally {
      setSending(false);
    }
  };

  const approveDraft = async (id: number, edited?: string) => {
    setBusy(true);
    try {
      await api.post(`/products/replies/${id}/send`, edited ? { edited } : {});
      setEditDraftId(null);
      setEditText('');
      if (activeId !== null) {
        await loadMessages(activeId, activeMp);
        await loadDrafts(activeId, activeMp);
      }
      setActionMsg('Antwort gesendet');
      setTimeout(() => setActionMsg(null), 3000);
    } catch (e) {
      setActionMsg(`${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setActionMsg(null), 6000);
    } finally {
      setBusy(false);
    }
  };

  const rejectDraft = async (id: number) => {
    setBusy(true);
    try {
      await api.post(`/products/replies/${id}/reject`);
      if (activeId !== null) await loadDrafts(activeId, activeMp);
    } finally {
      setBusy(false);
    }
  };

  const triggerAutopilot = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ scanned: number; drafted: number; sent: number }>('/products/replies/run');
      setActionMsg(`${r.drafted} neue Drafts (${r.scanned} gescannt, ${r.sent} sofort gesendet)`);
      if (activeId !== null) await loadDrafts(activeId, activeMp);
      setTimeout(() => setActionMsg(null), 5000);
    } catch (e) {
      setActionMsg(`${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOffer = async (action: 'accept' | 'decline') => {
    if (activeId === null) return;
    if (!confirm(action === 'accept' ? 'Angebot wirklich annehmen?' : 'Angebot ablehnen?')) return;
    setBusy(true);
    try {
      const base =
        activeMp === 'depop' ? `/depop/chats/${activeId}/offers/${action}` :
        `/chats/${activeId}/offer/${action}`;
      await api.post(base);
      toast.success(action === 'accept' ? 'Angebot angenommen' : 'Angebot abgelehnt');
      await loadChats();
      await loadMessages(activeId, activeMp);
    } catch (e) {
      toast.error('Aktion fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const activeChat = chats.find((c) => c.id === activeId);
  const lastIncomingOffer = [...messages].reverse().find((m) => m.direction === 'in' && m.is_offer === 1);

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      {/* Chat-Liste */}
      <div className="w-80 overflow-y-auto">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Chats</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void repairDates()}
              disabled={repairing}
              className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
              title="Repariert falsche Datums-Sortierung (parst echtes Datum aus Nachrichten-Text statt Scrape-Zeit)"
            >
              {repairing ? '…' : 'Daten-Fix'}
            </button>
            <button
              onClick={triggerAutopilot}
              disabled={busy}
              className="rounded bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
              title="Autopilot scannt jetzt unbeantwortete Nachrichten"
            >
              Auto
            </button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => setMpFilter(f.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                mpFilter === f.id
                  ? 'border-rose-500 bg-rose-500/10 text-rose-200'
                  : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          {chats.length === 0 && <div className="text-sm text-zinc-500">Noch keine Chats.</div>}
          {chats.map((c) => {
            const mp = c.marketplace ?? 'vinted';
            const isActive = activeId === c.id && activeMp === mp;
            return (
              <button
                key={`${mp}-${c.id}`}
                className={`w-full rounded-md border p-3 text-left ${
                  isActive
                    ? 'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/30'
                    : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900/40'
                }`}
                onClick={() => { setActiveId(c.id); setActiveMp(mp); }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <MarketplaceBadge id={mp} size="sm" />
                  <span className="font-medium flex-1 truncate text-zinc-100">{c.buyer_username}</span>
                  <div className="flex items-center gap-1">
                    {c.pending_drafts > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {c.pending_drafts}
                      </span>
                    )}
                    {c.unread > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                        {c.unread}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">{c.message_count}</span>
                  </div>
                </div>
                {c.ad_title && (
                  <div className="truncate text-[11px] text-zinc-500 mb-0.5">{c.ad_title}</div>
                )}
                <div className="truncate text-xs text-zinc-400">
                  {c.last_message_at ? new Date(c.last_message_at).toLocaleString('de-DE') : '—'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat-Verlauf */}
      <div className="flex flex-1 flex-col overflow-hidden card">
        {activeId === null ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            Chat auswählen
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <div>
                <div className="font-bold">{activeChat?.buyer_username}</div>
                <div className="text-xs text-zinc-500">{activeChat?.message_count} Nachrichten</div>
              </div>
              <div className="flex items-center gap-2">
                {actionMsg && <span className="text-xs text-zinc-300">{actionMsg}</span>}
                {lastIncomingOffer && (
                  <>
                    <button
                      onClick={() => handleOffer('accept')}
                      disabled={busy}
                      className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                      title={`${fmtEur(lastIncomingOffer.offer_amount_eur ?? 0)} annehmen`}
                    >
                      Annehmen {fmtEur(lastIncomingOffer.offer_amount_eur ?? 0)}
                    </button>
                    <button
                      onClick={() => handleOffer('decline')}
                      disabled={busy}
                      className="rounded bg-zinc-800 px-3 py-1 text-xs font-bold text-zinc-300 hover:bg-slate-300 disabled:opacity-50"
                    >
                      ✗ Ablehnen
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-lg p-2 text-sm ${
                    m.direction === 'in'
                      ? 'bg-zinc-800'
                      : 'ml-auto bg-brand-500 text-white'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {m.is_offer === 1 && m.offer_amount_eur !== null && (
                    <div className="mt-1 text-xs opacity-75">
                      → Angebot: {fmtEur(m.offer_amount_eur)}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] opacity-50">
                    {new Date(m.created_at).toLocaleTimeString('de-DE')}
                  </div>
                </div>
              ))}
            </div>

            {/* Autopilot Drafts */}
            {drafts.length > 0 && (
              <div className="border-t border-zinc-800 bg-rose-50 px-4 py-3">
                <div className="mb-2 text-xs font-bold text-rose-700">
                  {drafts.length} Autopilot-Vorschlag{drafts.length === 1 ? '' : 'e'}
                </div>
                <div className="space-y-2">
                  {drafts.map((d) => (
                    <div key={d.id} className="rounded-md border border-rose-200 bg-zinc-900/60 p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                          {d.intent}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(d.created_at).toLocaleTimeString('de-DE')}
                        </span>
                      </div>
                      <div className="mb-2 text-xs italic text-zinc-400">"{d.in_text}"</div>
                      {editDraftId === d.id ? (
                        <textarea
                          className="w-full rounded border border-zinc-700 p-2 text-sm"
                          rows={3}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                      ) : (
                        <div className="mb-2 whitespace-pre-wrap rounded bg-zinc-900/40 p-2 text-sm">
                          {d.draft_text}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        {editDraftId === d.id ? (
                          <>
                            <button
                              onClick={() => { setEditDraftId(null); setEditText(''); }}
                              className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-slate-300"
                            >
                              Abbrechen
                            </button>
                            <button
                              onClick={() => approveDraft(d.id, editText)}
                              disabled={busy || !editText.trim()}
                              className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              ✓ Bearbeitet senden
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => rejectDraft(d.id)}
                              disabled={busy}
                              className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-slate-300 disabled:opacity-50"
                            >
                              Verwerfen
                            </button>
                            <button
                              onClick={() => { setEditDraftId(d.id); setEditText(d.draft_text); }}
                              className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600"
                            >
                              ✎ Bearbeiten
                            </button>
                            <button
                              onClick={() => approveDraft(d.id)}
                              disabled={busy}
                              className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              ✓ Senden
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reply-Input */}
            <div className="border-t border-zinc-800 px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  className="flex-1 rounded-md border border-zinc-700 p-2 text-sm"
                  rows={2}
                  placeholder="Antwort schreiben…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
                  }}
                  disabled={sending}
                />
                <button
                  onClick={send}
                  disabled={sending || !reply.trim()}
                  className="rounded-md bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {sending ? '…' : 'Senden'}
                </button>
              </div>
              <div className="mt-1 text-[10px] text-zinc-500">⌘+Enter zum Senden</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
