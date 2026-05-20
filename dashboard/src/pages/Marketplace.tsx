import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ExternalLink, RotateCcw, Trash2, Plus, Eye, Heart, MessageSquare, Inbox, AlertTriangle, Shield } from 'lucide-react';
import { api } from '../api/client';
import { getBrand } from '../lib/marketplace';
import { MarketplaceBadge } from '../components/MarketplaceBadge';
import { fmtEur, fmtNum } from '../lib/format';
import { CountUp } from '../components/CountUp';
import { toast } from '../components/Toast';
import { useAccountId } from '../hooks/useAccountId';

interface MpListing {
  id: number;
  marketplace: string;
  account_id: number;
  folder_num: number;
  external_id: string | null;
  external_url: string | null;
  status: string;
  list_price_eur: number;
  views: number;
  likes: number;
  messages: number;
  last_error: string | null;
  updated_at: string;
  folder_title: string | null;
  folder_size: string | null;
  folder_brand: string | null;
}

interface Summary {
  marketplace: string;
  counts: Array<{ status: string; n: number }>;
  totals: { views: number; likes: number; messages: number };
}

interface KaChat {
  id: number;
  account_id: number;
  ka_conversation_id: string;
  buyer_username: string;
  ad_title: string | null;
  ad_url: string | null;
  last_message_at: string | null;
  unread: number;
  message_count: number;
  last_message_body: string | null;
  last_direction: string | null;
}

interface KaMessage {
  id: number;
  chat_id: number;
  direction: 'in' | 'out';
  body: string;
  is_offer: number;
  offer_amount_eur: number | null;
  created_at: string;
}

interface KaDraft {
  id: number;
  intent: string;
  in_text: string;
  draft_text: string;
  status: string;
  created_at: string;
}

const MARKETPLACE_META: Record<string, { label: string; emoji: string; baseUrl: string; locale: string }> = {
  vinted:         { label: 'Vinted',         emoji: '👗', baseUrl: 'https://www.vinted.de',            locale: 'DE' },
  kleinanzeigen:  { label: 'Kleinanzeigen',  emoji: '🏷️', baseUrl: 'https://www.kleinanzeigen.de',    locale: 'DE' },
  mercari:        { label: 'Mercari',        emoji: '🇺🇸', baseUrl: 'https://www.mercari.com',          locale: 'US' },
  depop:          { label: 'Depop',          emoji: '🇬🇧', baseUrl: 'https://www.depop.com',            locale: 'UK' },
  wallapop:       { label: 'Wallapop',       emoji: '🇪🇸', baseUrl: 'https://es.wallapop.com',          locale: 'ES' },
  ebay_de:        { label: 'eBay DE',        emoji: '🛒', baseUrl: 'https://www.ebay.de',              locale: 'DE' },
  ebay_uk:        { label: 'eBay UK',        emoji: '🛒', baseUrl: 'https://www.ebay.co.uk',           locale: 'UK' },
  etsy:           { label: 'Etsy',           emoji: '🎨', baseUrl: 'https://www.etsy.com',             locale: 'US' },
  grailed:        { label: 'Grailed',        emoji: '👔', baseUrl: 'https://www.grailed.com',           locale: 'US' },
  fb_marketplace: { label: 'FB Marketplace', emoji: '📘', baseUrl: 'https://www.facebook.com/marketplace', locale: 'DE' },
  // Tier-1 + Enterprise + EU Champions — added so deep-links don't 404 onto Vinted.
  vestiaire:      { label: 'Vestiaire',      emoji: '👜', baseUrl: 'https://www.vestiairecollective.com', locale: 'FR' },
  whatnot:        { label: 'Whatnot',        emoji: '🎙️', baseUrl: 'https://www.whatnot.com',           locale: 'US' },
  poshmark:       { label: 'Poshmark',       emoji: '👛', baseUrl: 'https://poshmark.com',             locale: 'US' },
  leboncoin:      { label: 'Leboncoin',      emoji: '🇫🇷', baseUrl: 'https://www.leboncoin.fr',          locale: 'FR' },
  marktplaats:    { label: 'Marktplaats',    emoji: '🇳🇱', baseUrl: 'https://www.marktplaats.nl',        locale: 'NL' },
  willhaben:      { label: 'Willhaben',      emoji: '🇦🇹', baseUrl: 'https://www.willhaben.at',          locale: 'AT' },
  shopify:        { label: 'Shopify',        emoji: '🛒', baseUrl: 'https://admin.shopify.com',         locale: 'US' },
  woocommerce:    { label: 'WooCommerce',    emoji: '🛍️', baseUrl: 'https://woocommerce.com',           locale: 'US' },
};

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  draft:       'bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/40',
  publishing:  'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  sold:        'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  deactivated: 'bg-zinc-700/30 text-zinc-500 ring-1 ring-zinc-600/30',
  failed:      'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
};

type Tab = 'listings' | 'messages';

export function MarketplacePage() {
  const { mp = 'vinted' } = useParams<{ mp: string }>();
  const meta = MARKETPLACE_META[mp] ?? MARKETPLACE_META.vinted!;
  const brand = getBrand(mp);
  const Icon = brand.icon;
  const supportsMessages = mp === 'kleinanzeigen' || mp === 'depop';
  const [tab, setTab] = useState<Tab>('listings');

  return (
    <div className="space-y-6 pb-8">
      {/* Branded Hero */}
      <div className={`relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br ${brand.gradient} p-6`}>
        <div className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full ${brand.bgTint} blur-3xl`} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`grid h-14 w-14 place-items-center rounded-xl ${brand.bgTint} ring-1 ${brand.ring}`}>
              <Icon size={26} className={brand.text} strokeWidth={2.1} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-100">{brand.label}</h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                <a href={brand.baseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-zinc-200">
                  {brand.baseUrl.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
                </a>
                <span className="text-zinc-700">·</span>
                <span>{brand.locale}</span>
              </div>
            </div>
          </div>
          <Link to="/listings" className="btn-ghost">
            <Plus size={14} /> Anzeige anlegen
          </Link>
        </div>
        {brand.cloudflareProtected && (
          <div className="relative mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200">
            <Shield size={14} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="flex-1">
              <div className="font-semibold text-amber-100">Cloudflare Bot Protection aktiv</div>
              <div className="mt-0.5 text-amber-200/80">
                Sessions werden pre-warmed, Turnstile-Widgets automatisch über 2captcha gelöst.
                Bei hard-block (HTTP&nbsp;403) erscheint ein Resume-Banner — entweder kurz warten oder
                Profil zurücksetzen.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        <button
          onClick={() => setTab('listings')}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            tab === 'listings' ? 'border-rose-500 text-rose-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Listings
        </button>
        <button
          onClick={() => setTab('messages')}
          disabled={!supportsMessages}
          title={!supportsMessages ? 'Inbox-Polling für diese Plattform noch nicht implementiert' : ''}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            tab === 'messages' ? 'border-rose-500 text-rose-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          } ${!supportsMessages ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          Nachrichten {!supportsMessages && <span className="text-[10px]">(soon)</span>}
        </button>
      </div>

      {tab === 'listings' && <ListingsTab mp={mp} meta={meta} />}
      {tab === 'messages' && mp === 'kleinanzeigen' && <KaMessagesTab />}
      {tab === 'messages' && mp === 'depop' && <DepopMessagesHint />}
      {tab === 'messages' && !supportsMessages && (
        <div className="card flex items-start gap-2.5 border-amber-500/30 bg-amber-500/5 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Inbox-Polling für {brand.label} ist noch nicht implementiert.</span>
        </div>
      )}
    </div>
  );
}

// ─── Listings Tab ─────────────────────────────────────────────────────────

function ListingsTab({ mp, meta }: { mp: string; meta: typeof MARKETPLACE_META[string] }) {
  const accountId = useAccountId();
  const [listings, setListings] = useState<MpListing[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<{ online: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [l, s, h] = await Promise.all([
        api.get<{ listings: MpListing[] }>(`/products/marketplace/${mp}/listings`),
        api.get<Summary>(`/products/marketplace/${mp}/summary`),
        api.get<{ marketplaces: Array<{ marketplace: string; online: boolean }> }>('/products/marketplaces/health'),
      ]);
      setListings(l.listings);
      setSummary(s);
      const me = h.marketplaces.find((m) => m.marketplace === mp);
      setHealth(me ? { online: me.online } : null);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [mp]);

  const brand = getBrand(mp);
  const filtered = useMemo(() => filter ? listings.filter((l) => l.status === filter) : listings, [listings, filter]);
  const totalActive = summary?.counts.find((c) => c.status === 'active')?.n ?? 0;
  const totalSold = summary?.counts.find((c) => c.status === 'sold')?.n ?? 0;
  const totalFailed = summary?.counts.find((c) => c.status === 'failed')?.n ?? 0;

  const deactivate = async (l: MpListing) => {
    if (!confirm(`Listing auf ${meta.label} verkauft markieren?`)) return;
    setBusy(l.id);
    try {
      await fetch(`/api/products/sold`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderNum: l.folder_num, soldOn: l.marketplace, priceEur: l.list_price_eur }),
      });
      toast.success('Cross-Sync getriggert');
      await load();
    } catch (e) { toast.error('Sync fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const triggerKpi = async () => {
    setBusy(-1);
    try {
      const r = await api.post<{ updated: number; errors: number }>('/products/performance/collect', { limit: 50 });
      toast.success('KPIs aktualisiert', { detail: `${r.updated} synced · ${r.errors} Fehler` });
      await load();
    } catch (e) { toast.error('KPI-Sammlung fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const resetProfile = async () => {
    if (!confirm(`${meta.label} Browser-Profil komplett löschen?\n\nNötig wenn ${meta.label} dich wegen "Bot-Verdacht" geblockt hat. Du musst dich danach NEU einloggen.`)) return;
    setBusy(-2);
    try {
      const port = mp === 'vinted' ? 4701
                : mp === 'kleinanzeigen' ? 4703
                : mp === 'mercari' ? 4704
                : mp === 'depop' ? 4705
                : mp === 'wallapop' ? 4706
                : mp === 'ebay_de' ? 4707
                : mp === 'ebay_uk' ? 4708
                : mp === 'etsy' ? 4709
                : mp === 'grailed' ? 4710
                : mp === 'fb_marketplace' ? 4711
                : 4701;
      const r = await fetch(`http://localhost:${port}/api/auth/reset-profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId }),
      });
      const d = await r.json() as { ok: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? 'reset failed');
      toast.warn('Browser-Profil zurückgesetzt', { detail: `Neu einloggen via Terminal: npm run ${mp}:login` });
    } catch (e) { toast.error('Reset fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  // (legacy actionMsg state retained but unused — toasts replace it)
  void actionMsg;
  void setActionMsg;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${health === null ? 'bg-zinc-600' : health.online ? 'bg-rose-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-rose-400'}`} />
          <span className="text-xs font-semibold text-zinc-300">Bot {health === null ? '…' : health.online ? 'online' : 'offline'}</span>
        </div>
        <button onClick={triggerKpi} disabled={busy !== null} className="btn-secondary text-xs">
          <Eye size={13} /> {busy === -1 ? '…' : 'KPI sammeln'}
        </button>
        <button onClick={resetProfile} disabled={busy !== null} className="btn-ghost text-xs" title="Browser-Profil löschen — nötig nach Bot-Block">
          <RotateCcw size={13} /> {busy === -2 ? '…' : 'Profil reset'}
        </button>
        <Link to="/listings" className="btn-primary text-xs">
          <Plus size={13} /> Anzeige
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Gesamt"   value={listings.length} active={filter === ''}       onClick={() => setFilter('')}       accent={brand.text} />
        <StatTile label="Aktiv"    value={totalActive}     active={filter === 'active'} onClick={() => setFilter('active')} accent="text-rose-400" />
        <StatTile label="Verkauft" value={totalSold}       active={filter === 'sold'}   onClick={() => setFilter('sold')}   accent="text-blue-400" />
        <StatTile label="Fehler"   value={totalFailed}     active={filter === 'failed'} onClick={() => setFilter('failed')} accent="text-rose-400" />
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="kpi-label">Engagement</div>
          <div className="mt-2 flex gap-3 text-sm">
            <span className="inline-flex items-center gap-1 text-zinc-300"><Eye size={13} className="text-zinc-500" /> {fmtNum(summary?.totals.views ?? 0)}</span>
            <span className="inline-flex items-center gap-1 text-zinc-300"><Heart size={13} className="text-zinc-500" /> {fmtNum(summary?.totals.likes ?? 0)}</span>
            <span className="inline-flex items-center gap-1 text-zinc-300"><MessageSquare size={13} className="text-zinc-500" /> {fmtNum(summary?.totals.messages ?? 0)}</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-sm">
          <div className="font-semibold text-zinc-100">
            <CountUp value={filtered.length} format={(n) => fmtNum(Math.round(n))} /> Listings
            {filter && <span className="ml-2 text-xs font-normal text-zinc-500">({filter})</span>}
          </div>
          <MarketplaceBadge id={mp} size="sm" />
        </div>
        {loading && (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-12 rounded" />)}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <Inbox size={32} className="mb-3 text-zinc-600" strokeWidth={1.5} />
            <div className="text-sm font-semibold text-zinc-200">Noch keine Listings auf {brand.label}</div>
            <Link to="/listings" className="btn-primary mt-4 text-xs">
              <Plus size={13} /> Anzeige anlegen
            </Link>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Folder</th>
                <th>Titel</th>
                <th>Status</th>
                <th className="text-right">Preis</th>
                <th className="text-right">Views</th>
                <th className="text-right">Likes</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs">
                    <Link to={`/products/${l.folder_num}`} className="text-rose-300 hover:underline">#{l.folder_num}</Link>
                  </td>
                  <td>
                    <div className="font-medium text-zinc-100">{l.folder_title ?? '(unbenannt)'}</div>
                    <div className="text-[11px] text-zinc-500">
                      {l.folder_size && <span>Gr. {l.folder_size}</span>}
                      {l.folder_brand && l.folder_brand !== 'Ohne Marke' && <span> · {l.folder_brand}</span>}
                    </div>
                    {l.last_error && (
                      <div className="mt-1 inline-flex items-center gap-1 truncate text-[10px] text-rose-300" title={l.last_error}>
                        <AlertTriangle size={10} /> {l.last_error}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[l.status] ?? 'bg-zinc-700 text-zinc-300'}`}>{l.status}</span>
                  </td>
                  <td className="text-right tabular text-zinc-200">{fmtEur(l.list_price_eur)}</td>
                  <td className="text-right tabular">{fmtNum(l.views)}</td>
                  <td className="text-right tabular">{fmtNum(l.likes)}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {l.external_url && (
                        <a href={l.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
                          <ExternalLink size={11} /> Öffnen
                        </a>
                      )}
                      {l.status === 'active' && (
                        <button onClick={() => deactivate(l)} disabled={busy === l.id} className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:opacity-50">
                          <Trash2 size={11} /> Verkauft
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DepopMessagesHint() {
  return (
    <div className="card flex items-start gap-2.5 border-rose-500/30 bg-rose-500/[0.04] text-sm text-rose-200">
      <MessageSquare size={16} className="mt-0.5 shrink-0 text-rose-300" />
      <div>
        <div className="font-semibold text-rose-100">Depop-Chats laufen über die Verkauf-Seite</div>
        <div className="mt-0.5 text-rose-200/80">
          Öffne <Link to="/verkauf" className="underline hover:text-rose-50">Verkauf → Chats</Link> — dort findest du
          Depop- und Kleinanzeigen-Konversationen mit Filter pro Marktplatz und Offer-Accept-/Decline-Buttons.
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label, value, active, onClick, accent,
}: {
  label: string; value: number; active: boolean; onClick: () => void; accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
      }`}
    >
      <div className="kpi-label">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular ${accent}`}>
        <CountUp value={value} format={(n) => fmtNum(Math.round(n))} />
      </div>
    </button>
  );
}

// ─── KA Messages Tab ──────────────────────────────────────────────────────

function KaMessagesTab() {
  const [chats, setChats] = useState<KaChat[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<KaMessage[]>([]);
  const [drafts, setDrafts] = useState<KaDraft[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editDraftId, setEditDraftId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadChats = async () => {
    try { setChats(await api.get<KaChat[]>('/kleinanzeigen/chats')); }
    catch (e) { console.error(e); }
  };
  const loadMessages = async (id: number) => {
    try {
      const rows = await api.get<KaMessage[]>(`/kleinanzeigen/chats/${id}/messages`);
      setMessages(rows);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 50);
    } catch (e) { console.error(e); }
  };
  const loadDrafts = async (id: number) => {
    try {
      const r = await api.get<{ drafts: KaDraft[] }>(`/kleinanzeigen/chats/${id}/pending-replies`);
      setDrafts(r.drafts);
    } catch { setDrafts([]); }
  };

  useEffect(() => { void loadChats(); }, []);
  useEffect(() => {
    if (activeId !== null) {
      void loadMessages(activeId);
      void loadDrafts(activeId);
      void api.post(`/kleinanzeigen/chats/${activeId}/read`).catch(() => null);
    }
  }, [activeId]);

  const triggerPoll = async () => {
    setPolling(true);
    try {
      const r = await api.post<{ conversations?: number; newMessages?: number }>('/kleinanzeigen/chats/poll');
      setActionMsg(`📥 ${r.newMessages ?? 0} neue Nachrichten in ${r.conversations ?? 0} Chats`);
      await loadChats();
      if (activeId !== null) { await loadMessages(activeId); await loadDrafts(activeId); }
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPolling(false);
      setTimeout(() => setActionMsg(null), 6000);
    }
  };

  const send = async () => {
    if (!reply.trim() || activeId === null) return;
    setBusy(true);
    try {
      await api.post(`/kleinanzeigen/chats/${activeId}/send`, { body: reply.trim() });
      setReply('');
      await loadMessages(activeId);
      await loadChats();
      setActionMsg('✅ Gesendet');
    } catch (e) { setActionMsg(`❌ ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); setTimeout(() => setActionMsg(null), 4000); }
  };

  const approveDraft = async (id: number, edited?: string) => {
    setBusy(true);
    try {
      await api.post(`/products/replies/${id}/send`, edited ? { edited } : {});
      setEditDraftId(null);
      setEditText('');
      if (activeId !== null) { await loadMessages(activeId); await loadDrafts(activeId); }
      setActionMsg('✅ Antwort gesendet');
    } catch (e) { setActionMsg(`❌ ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); setTimeout(() => setActionMsg(null), 4000); }
  };

  const rejectDraft = async (id: number) => {
    setBusy(true);
    try { await api.post(`/products/replies/${id}/reject`); if (activeId !== null) await loadDrafts(activeId); }
    finally { setBusy(false); }
  };

  const activeChat = chats.find((c) => c.id === activeId);

  return (
    <div className="flex h-[calc(100vh-260px)] gap-4">
      {/* Chat-Liste */}
      <div className="w-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <span className="text-sm font-bold">Chats ({chats.length})</span>
          <button
            onClick={triggerPoll}
            disabled={polling}
            className="rounded bg-rose-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-rose-600 disabled:opacity-50"
            title="Postfach jetzt aktualisieren"
          >
            {polling ? '…' : '↻ Sync'}
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {chats.length === 0 && (
            <div className="p-4 text-center text-xs text-zinc-500">
              Noch keine Chats.<br />
              <button onClick={triggerPoll} disabled={polling} className="mt-2 text-rose-300 underline">
                Inbox jetzt syncen
              </button>
            </div>
          )}
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full p-3 text-left text-sm ${activeId === c.id ? 'bg-rose-500/10' : 'hover:bg-zinc-900/60'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.buyer_username}</span>
                {c.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unread}</span>}
              </div>
              {c.ad_title && <div className="truncate text-[11px] text-zinc-400">{c.ad_title}</div>}
              {c.last_message_body && (
                <div className="mt-1 truncate text-[11px] text-zinc-500">
                  {c.last_direction === 'out' ? '↗ ' : ''}{c.last_message_body.slice(0, 60)}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Verlauf + Reply */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
        {activeId === null ? (
          <div className="flex h-full items-center justify-center text-zinc-500">Chat auswählen</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <div>
                <div className="font-bold">{activeChat?.buyer_username}</div>
                {activeChat?.ad_title && (
                  <div className="text-xs text-zinc-400">
                    {activeChat.ad_url ? (
                      <a href={activeChat.ad_url} target="_blank" rel="noreferrer" className="hover:underline">{activeChat.ad_title} ↗</a>
                    ) : activeChat.ad_title}
                  </div>
                )}
              </div>
              {actionMsg && <span className="text-xs text-zinc-200">{actionMsg}</span>}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[75%] rounded-lg p-2 text-sm ${m.direction === 'in' ? 'bg-zinc-800' : 'ml-auto bg-rose-500 text-white'}`}>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {m.is_offer === 1 && m.offer_amount_eur !== null && (
                    <div className="mt-1 text-xs opacity-75">→ Angebot: €{m.offer_amount_eur.toFixed(2)}</div>
                  )}
                  <div className="mt-1 text-[10px] opacity-50">{new Date(m.created_at).toLocaleTimeString('de-DE')}</div>
                </div>
              ))}
            </div>

            {drafts.length > 0 && (
              <div className="border-t border-zinc-800 bg-rose-500/5 border border-rose-500/30 px-4 py-3">
                <div className="mb-2 text-xs font-bold text-rose-700">🤖 {drafts.length} Autopilot-Vorschlag</div>
                <div className="space-y-2">
                  {drafts.map((d) => (
                    <div key={d.id} className="rounded-md border border-rose-500/30 bg-zinc-900/40 p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">{d.intent}</span>
                        <span className="text-[10px] text-zinc-500">{new Date(d.created_at).toLocaleTimeString('de-DE')}</span>
                      </div>
                      <div className="mb-2 text-xs italic text-zinc-400">"{d.in_text}"</div>
                      {editDraftId === d.id ? (
                        <textarea className="w-full rounded border border-zinc-700 p-2 text-sm" rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} />
                      ) : (
                        <div className="mb-2 whitespace-pre-wrap rounded bg-zinc-900/60 p-2 text-sm">{d.draft_text}</div>
                      )}
                      <div className="flex justify-end gap-2">
                        {editDraftId === d.id ? (
                          <>
                            <button onClick={() => { setEditDraftId(null); setEditText(''); }} className="rounded bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600">Abbrechen</button>
                            <button onClick={() => approveDraft(d.id, editText)} disabled={busy || !editText.trim()} className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">✓ Bearbeitet senden</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => rejectDraft(d.id)} disabled={busy} className="rounded bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600 disabled:opacity-50">Verwerfen</button>
                            <button onClick={() => { setEditDraftId(d.id); setEditText(d.draft_text); }} className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600">✎ Bearbeiten</button>
                            <button onClick={() => approveDraft(d.id)} disabled={busy} className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">✓ Senden</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-zinc-800 px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  className="flex-1 rounded-md border border-zinc-700 p-2 text-sm"
                  rows={2}
                  placeholder="Antwort schreiben…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                  disabled={busy}
                />
                <button onClick={send} disabled={busy || !reply.trim()} className="rounded-md bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50">
                  {busy ? '…' : 'Senden'}
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
