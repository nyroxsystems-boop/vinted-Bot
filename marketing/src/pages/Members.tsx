// Members — gated dashboard for logged-in users.
//
// Layout: 3-column on desktop (sidebar with channels · main with licenses
// or chat · right rail with account info). 1-column on mobile with a
// segmented tab bar at the top to swap between "Licenses" and "Chat".
//
// All data fetched fresh on mount via /api/members/dashboard. Chat uses
// SSE for live updates with optimistic posting.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  KeyRound, Copy, Check, ExternalLink, LogOut, Send, Hash, Sparkles,
  MessageCircle, CreditCard, Loader2, Monitor, RefreshCw,
} from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useAuth } from '../lib/auth';

interface License {
  key: string;
  tier: 'starter' | 'hustler';
  cadence: 'monthly';
  status: 'active' | 'cancelled' | 'expired';
  stripe_customer: string | null;
  stripe_sub: string | null;
  issued_at: string;
  expires_at: string | null;
}

interface ChatMessage {
  id: number;
  body: string;
  created_at: string;
  user_id: number;
  user_email: string;
}

const CHANNELS = ['general', 'support', 'sales-wins', 'beta'] as const;
type Channel = typeof CHANNELS[number];

export function MembersPage() {
  const navigate = useNavigate();
  const { user, ready, logout } = useAuth();

  useEffect(() => {
    if (ready && !user) navigate('/login?next=/members', { replace: true });
  }, [ready, user, navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen">
        <Nav />
        <div className="grid h-[60vh] place-items-center text-zinc-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </div>
    );
  }
  if (!user) return null;

  return <Dashboard onLogout={async () => { await logout(); navigate('/', { replace: true }); }} />;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [email,    setEmail]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'licenses' | 'chat'>('licenses');
  const [channel,  setChannel]  = useState<Channel>('general');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/members/dashboard', { credentials: 'include' });
    const data = await r.json();
    if (data.ok) {
      setLicenses(data.licenses);
      setEmail(data.user.email);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="px-5 py-10 md:py-14">
        <div className="container-narrow">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="eyebrow"><Sparkles size={12} /> Member-Space</span>
              <h1 className="font-display mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Willkommen zurück.
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Eingeloggt als <span className="font-mono text-zinc-200">{email}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="btn-ghost text-sm"
            >
              <LogOut size={14} /> Abmelden
            </button>
          </div>

          {/* Mobile tabs */}
          <div className="mt-8 flex rounded-xl border border-white/10 bg-white/[0.03] p-1 md:hidden">
            {(['licenses', 'chat'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  tab === t ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t === 'licenses' ? <KeyRound size={14} /> : <MessageCircle size={14} />}
                {t === 'licenses' ? 'Lizenzen' : 'Chat'}
              </button>
            ))}
          </div>

          {/* Main grid */}
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_2fr]">
            {/* Left rail: channel list (chat) + account on desktop */}
            <aside className="space-y-4 md:sticky md:top-24 md:self-start">
              <ChannelList active={channel} setActive={setChannel} hideOnMobile={tab !== 'chat'} />
              <AccountCard email={email} licenses={licenses} />
            </aside>

            {/* Main column */}
            <main className="space-y-6">
              <div className={tab === 'licenses' ? 'block' : 'hidden md:block'}>
                <LicenseList licenses={licenses} loading={loading} />
                <DesktopPairPanel />
              </div>
              <div className={tab === 'chat' ? 'block' : 'hidden md:block'}>
                <ChatPanel channel={channel} currentEmail={email} />
              </div>
            </main>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Channel sidebar
// ──────────────────────────────────────────────────────────────────────────────
function ChannelList({
  active,
  setActive,
  hideOnMobile,
}: {
  active: Channel;
  setActive: (c: Channel) => void;
  hideOnMobile: boolean;
}) {
  return (
    <div className={hideOnMobile ? 'hidden md:block' : ''}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Channels</div>
      <div className="mt-2 space-y-0.5 rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              active === c ? 'bg-ruby-500/15 text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <Hash size={14} className={active === c ? 'text-ruby-300' : 'text-zinc-600'} />
            <span className="font-medium">{c}</span>
            {active === c && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ruby-400" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Account card (right rail on desktop, below licenses on mobile)
// ──────────────────────────────────────────────────────────────────────────────
function AccountCard({ email, licenses }: { email: string; licenses: License[] }) {
  const [portalBusy, setPortalBusy] = useState(false);
  const hasActive = licenses.some((l) => l.status === 'active');

  async function openPortal() {
    setPortalBusy(true);
    try {
      const r = await fetch('/api/members/portal', { method: 'POST', credentials: 'include' });
      const data = await r.json();
      if (data.ok && data.url) window.location.href = data.url;
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Account</div>
      <div className="mt-2 truncate text-sm font-mono text-white">{email}</div>
      <div className="mt-1 text-[11px] text-zinc-500">
        {licenses.length === 0
          ? 'Noch kein Plan aktiv.'
          : `${licenses.length} Lizenz${licenses.length === 1 ? '' : 'en'} · ${hasActive ? 'Aktiv' : 'Pausiert'}`}
      </div>

      {hasActive ? (
        <button
          type="button"
          onClick={openPortal}
          disabled={portalBusy}
          className="btn-ghost mt-4 w-full justify-center text-xs"
        >
          {portalBusy ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
          Abo verwalten
        </button>
      ) : (
        <Link to="/pricing" className="btn-primary mt-4 w-full justify-center text-xs">
          <Sparkles size={12} /> Lizenz holen
        </Link>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Desktop pairing panel
//
// Generates a short-lived 6-char code that the user types into the Tauri
// app's SessionGate. This is the only way Google-signed-up users can log
// into the desktop without typing a password (the Tauri webview can't host
// Google's OAuth iframe — tauri:// isn't an authorised origin).
// ──────────────────────────────────────────────────────────────────────────────
function DesktopPairPanel() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);

  // Live ticking countdown — re-renders every second so the user sees the
  // remaining TTL shrink. When it hits zero, the code is automatically
  // hidden so nobody types a stale value.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0) {
        setCode(null);
        setExpiresAt(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch('/api/desktop/pair-start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error ?? 'failed');
      setCode(data.code);
      setExpiresAt(data.expires_at);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard rejected (rare) — user can still type the code manually.
    }
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-rose-500/20 to-indigo-500/20 text-rose-300 ring-1 ring-rose-500/20">
          <Monitor size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-white">Desktop-App verbinden</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            Wenn du dich mit Google angemeldet hast, klick hier um einen Einmal-Code zu generieren.
            Den Code gibst du in der Blackruby-App unter <span className="font-mono text-zinc-300">„Code aus Browser"</span> ein —
            danach ist das Gerät verbunden.
          </p>

          {!code && (
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="btn-primary mt-4 inline-flex items-center justify-center gap-2 text-xs"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              Code generieren
            </button>
          )}

          {code && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
                Dein Code · gültig {mins}:{String(secs).padStart(2, '0')}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <code className="select-all font-mono text-3xl font-bold tracking-[0.35em] text-white">{code}</code>
                <button
                  type="button"
                  onClick={copyCode}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-white/20 hover:text-white"
                  title="Code kopieren"
                >
                  {copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
                  {copied ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-500 transition hover:text-zinc-300"
              >
                <RefreshCw size={11} /> Neuen Code generieren
              </button>
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-rose-300">
              Fehler beim Generieren: {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// License list
// ──────────────────────────────────────────────────────────────────────────────
function LicenseList({ licenses, loading }: { licenses: License[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid h-40 place-items-center rounded-2xl border border-white/10 bg-white/[0.02] text-zinc-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  if (licenses.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <KeyRound size={32} className="mx-auto text-zinc-600" />
        <h3 className="mt-4 text-lg font-bold text-white">Noch keine Lizenz</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Hol dir Starter oder Pro — beide monatlich kündbar.
        </p>
        <Link to="/pricing" className="btn-primary mx-auto mt-5 text-sm">
          <Sparkles size={14} /> Plan wählen
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {licenses.map((l) => <LicenseCard key={l.key} license={l} />)}
    </div>
  );
}

function LicenseCard({ license }: { license: License }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(license.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const statusColor = {
    active:    'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    cancelled: 'border-amber-500/30  bg-amber-500/10  text-amber-200',
    expired:   'border-zinc-500/30   bg-zinc-500/10   text-zinc-200',
  }[license.status];

  const expires = license.expires_at ? new Date(license.expires_at).toLocaleDateString('de-DE') : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>{license.tier}</span>
            <span className="text-zinc-700">·</span>
            <span>{license.cadence}</span>
          </div>
          <div className="mt-2 break-all font-mono text-lg font-bold text-ruby-300">
            {license.key}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusColor}`}>
          {license.status}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-zinc-500">
        <div className="flex items-center gap-3">
          <span>Ausgestellt {new Date(license.issued_at).toLocaleDateString('de-DE')}</span>
          {expires && <><span className="text-zinc-700">·</span><span>Gültig bis {expires}</span></>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300 hover:bg-white/[0.06]"
          >
            {copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
            {copied ? 'kopiert' : 'kopieren'}
          </button>
          <Link
            to="/downloads"
            className="inline-flex items-center gap-1.5 rounded-md border border-ruby-500/30 bg-ruby-500/10 px-2 py-1 text-ruby-200 hover:bg-ruby-500/20"
          >
            <ExternalLink size={12} /> Download
          </Link>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat panel — live SSE
// ──────────────────────────────────────────────────────────────────────────────
function ChatPanel({ channel, currentEmail }: { channel: Channel; currentEmail: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft]       = useState('');
  const [posting, setPosting]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial load whenever channel switches
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/chat/messages?channel=${channel}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setMessages(data.ok ? data.messages : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [channel]);

  // Live stream
  useEffect(() => {
    const es = new EventSource(`/api/chat/stream?channel=${channel}`);
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as ChatMessage;
        setMessages((prev) =>
          prev.some((p) => p.id === m.id) ? prev : [...prev, m].slice(-200),
        );
      } catch {/* ignore non-JSON pings */}
    };
    es.onerror = () => {/* browser will auto-reconnect */};
    return () => es.close();
  }, [channel]);

  // Autoscroll on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    setDraft('');
    try {
      await fetch('/api/chat/post', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, body: text }),
      });
      // The SSE event will deliver the canonical row + id.
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex h-[60vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur">
      {/* Channel header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Hash size={14} className="text-ruby-300" />
          <span className="font-semibold text-white">{channel}</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> live
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="grid h-full place-items-center text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-zinc-500">
            Noch keine Nachrichten. Sei der erste in #{channel}.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} isSelf={m.user_email === currentEmail} />)
        )}
      </div>

      {/* Composer */}
      <form onSubmit={send} className="border-t border-white/5 bg-white/[0.02] px-3 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Nachricht in #${channel}…`}
            maxLength={2000}
            disabled={posting}
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-ruby-500 to-indigo-500 text-white disabled:opacity-40"
          >
            {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-600">
          Enter zum Senden · Max. 2.000 Zeichen
        </p>
      </form>
    </div>
  );
}

function MessageBubble({ m, isSelf }: { m: ChatMessage; isSelf: boolean }) {
  const name = m.user_email.split('@')[0];
  const time = useMemo(() => new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), [m.created_at]);
  const initial = name.charAt(0).toUpperCase();
  const hue = (name.charCodeAt(0) * 7 + name.length * 17) % 360;
  return (
    <div className={`flex items-start gap-2.5 ${isSelf ? 'flex-row-reverse' : ''}`}>
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
        style={{ background: `linear-gradient(135deg, hsl(${hue}, 75%, 55%), hsl(${(hue + 60) % 360}, 70%, 45%))` }}
      >
        {initial}
      </span>
      <div className={`min-w-0 max-w-[78%] ${isSelf ? 'text-right' : ''}`}>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500" style={{ flexDirection: isSelf ? 'row-reverse' : 'row' }}>
          <span className="font-mono">{name}</span>
          <span>·</span>
          <span>{time}</span>
        </div>
        <div className={`mt-1 inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          isSelf
            ? 'bg-gradient-to-br from-ruby-500/30 to-indigo-500/30 text-white'
            : 'bg-white/[0.04] text-zinc-100'
        }`}>
          {m.body}
        </div>
      </div>
    </div>
  );
}
