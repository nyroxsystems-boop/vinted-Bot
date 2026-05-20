// ──────────────────────────────────────────────────────────────────────────────
// Accounts — manage multi-marketplace logins.
//
// Each account can be connected to multiple marketplaces (Vinted, Kleinanzeigen,
// eBay, Depop, etc.). Each platform has its own login button and session status.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Edit3,
  Loader2,
  Lock,
  Plus,
  Power,
  PowerOff,
  Shield,
  ShieldAlert,
  Star,
  Trash2,
  UserCircle2,
  Globe,
} from 'lucide-react';
import { api } from '../api/client';
import { toast } from '../components/Toast';
import { AccountMetricsCard } from '../components/AccountMetricsChart';
import { MARKETPLACE_LOGINS } from '../lib/marketplace-logins';
import { getBrand } from '../lib/marketplace';
import { ProxySettingsModal } from '../components/ProxySettingsModal';

interface Account {
  id: number;
  label: string;
  username: string | null;
  active: number;
  logged_in: number;
  last_login_at: string | null;
  created_at: string;
  marketplace?: string | null;
  proxy_url?: string | null;
}

interface ListResponse {
  items: Account[];
  currentId: number;
}

// Platforms a user can spawn from the "+ Add Account" dialog. Must match
// the backend's PlatformId union (shared/src/accounts.ts).
const ACCOUNT_PLATFORMS: Array<{ id: string; label: string }> = [
  { id: 'vinted',        label: 'Vinted' },
  { id: 'ebay_de',       label: 'eBay DE' },
  { id: 'ebay_uk',       label: 'eBay UK' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen' },
  { id: 'depop',         label: 'Depop' },
  { id: 'mercari',       label: 'Mercari' },
  { id: 'wallapop',      label: 'Wallapop' },
  { id: 'etsy',          label: 'Etsy' },
];

// Display order for the page sections.
const GROUP_ORDER = [
  'vinted', 'ebay_de', 'ebay_uk', 'kleinanzeigen',
  'depop', 'mercari', 'wallapop', 'etsy',
];

export function AccountsPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentId, setCurrentId] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newPlatform, setNewPlatform] = useState<string>('vinted');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  // The ProxySettingsModal is opened by clicking "Proxy konfigurieren" on a
  // card. We keep just the account id here — the modal queries the rest.
  const [proxyForAccountId, setProxyForAccountId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<ListResponse>('/accounts');
      setAccounts(data.items);
      setCurrentId(data.currentId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, [load]);

  const createNew = async (): Promise<void> => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy('create');
    try {
      // Always send marketplace so the backend stores the correct platform
      // identity. Defaults to 'vinted' for back-compat with old code paths.
      await api.post('/accounts', { label, marketplace: newPlatform });
      setNewLabel('');
      setNewPlatform('vinted');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Group accounts by their marketplace column so the page renders one
  // section per platform (Vinted / eBay-DE / Kleinanzeigen / …). Legacy
  // rows with no marketplace value fall into the 'vinted' bucket.
  const grouped = useMemo(() => {
    const buckets = new Map<string, Account[]>();
    for (const a of accounts) {
      const mp = (a.marketplace ?? 'vinted') || 'vinted';
      const list = buckets.get(mp) ?? [];
      list.push(a);
      buckets.set(mp, list);
    }
    const ordered: Array<{ marketplace: string; accounts: Account[] }> = [];
    for (const mp of GROUP_ORDER) {
      const list = buckets.get(mp);
      if (list && list.length > 0) ordered.push({ marketplace: mp, accounts: list });
      buckets.delete(mp);
    }
    for (const [mp, list] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      ordered.push({ marketplace: mp, accounts: list });
    }
    return ordered;
  }, [accounts]);

  const showSections = grouped.length > 1;

  const toggleActive = async (acc: Account): Promise<void> => {
    setBusy(`active:${acc.id}`);
    try {
      await api.patch(`/accounts/${acc.id}`, { active: !acc.active });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const rename = async (id: number): Promise<void> => {
    const label = editLabel.trim();
    if (!label) return;
    setBusy(`rename:${id}`);
    try {
      await api.patch(`/accounts/${id}`, { label });
      setEditingId(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const makeCurrent = async (id: number): Promise<void> => {
    setBusy(`current:${id}`);
    try {
      await api.post('/accounts/select', { id });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const killAllSessions = async (wipe: boolean): Promise<void> => {
    const msg = wipe
      ? 'System pausieren, ALLE Vinted-Browser schließen UND Profile löschen?\n\n' +
        '• Master-Switch wird auf "pausiert" gesetzt (Worker stoppen)\n' +
        '• Alle Chromium-Fenster werden geschlossen\n' +
        '• Cookies/Login werden gelöscht — du musst dich neu einloggen\n\n' +
        'Nicht reversibel. Master-Switch musst du danach manuell wieder einschalten.'
      : 'System pausieren und alle Vinted-Browser schließen?\n\n' +
        '• Master-Switch wird auf "pausiert" gesetzt (Worker stoppen)\n' +
        '• Alle Chromium-Fenster werden geschlossen\n' +
        '• Cookies bleiben auf der Platte\n\n' +
        'Master-Switch musst du danach manuell wieder einschalten, sonst macht der Bot nichts.';
    if (!confirm(msg)) return;
    setBusy('kill-all');
    try {
      const result = await api.post<{
        ok: boolean;
        closed: number;
        wiped: number;
        wipe: boolean;
        paused: boolean;
        failed?: Array<{ id: number; step: string; error: string }>;
        in_flight_at_kill?: number;
      }>('/accounts/sessions/kill-all', { wipe });
      const detailParts: string[] = [];
      if (result.paused) {
        detailParts.push('System pausiert — Master-Switch in Operations manuell wieder an.');
      }
      if (result.in_flight_at_kill && result.in_flight_at_kill > 0) {
        detailParts.push(`⚠️ ${result.in_flight_at_kill} Job(s) waren mitten in Arbeit — Listings können in "publishing"-State hängen, stuck-recovery räumt das innerhalb 1 Min auf.`);
      }
      const failedCount = result.failed?.length ?? 0;
      if (failedCount > 0) {
        const first = result.failed![0]!;
        detailParts.push(`⚠️ ${failedCount} Account(s) konnten nicht sauber abgeräumt werden (z.B. #${first.id}: ${first.step} — ${first.error.slice(0, 80)})`);
      }
      const summary = wipe
        ? `${result.wiped}/${result.closed} Profile gewiped`
        : `${result.closed} Sessions geschlossen`;
      const fn = failedCount > 0 ? toast.error : toast.success;
      fn(summary, { detail: detailParts.join(' ') || 'Du kannst dich jetzt neu einloggen.' });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (acc: Account): Promise<void> => {
    if (
      !confirm(
        `Account "${acc.label}" wirklich löschen?\n\n` +
          'Alle zugehörigen Listings, Chats und Offers werden ebenfalls entfernt. ' +
          'Die Login-Session wird gelöscht.',
      )
    ) {
      return;
    }
    setBusy(`delete:${acc.id}`);
    try {
      await api.del(`/accounts/${acc.id}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Marketplace-Accounts
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Multi-Plattform Logins verwalten. Für jeden Account kannst du dich
            bei allen {MARKETPLACE_LOGINS.length} Marktplätzen anmelden.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Kill-All-Sessions — close every cached Playwright browser context
              before switching to a different account. Shift-click for the
              wipe-profile variant (full logout). */}
          <button
            className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm font-medium text-amber-200 hover:border-amber-500/60 hover:bg-amber-500/20 disabled:opacity-40"
            onClick={(e) => void killAllSessions(e.shiftKey)}
            disabled={busy !== null}
            title="System pausieren + alle Vinted-Browser schließen. Shift-Klick = Profile auch löschen (komplett-Logout)."
          >
            {busy === 'kill-all' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PowerOff size={14} />
            )}
            Alles stoppen
          </button>
          <button
            className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm"
            onClick={() => {
              document.getElementById('create-account-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => {
                document.querySelector<HTMLInputElement>('#create-account-form input')?.focus();
              }, 400);
            }}
            title="Neuen Account anlegen"
          >
            <Plus size={16} />
            Neuer Account
          </button>
        </div>
      </div>

      {/* Login-Workflow + Cloudflare-Hinweis */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <div className="font-semibold text-amber-100">So funktioniert der Login</div>
        <ol className="mt-1 list-decimal pl-4 space-y-0.5 text-amber-200/90">
          <li>Klick auf einen Marketplace-Button unten — ein Chrome-Fenster öffnet sich sichtbar (off-screen während Bot-Operations, sichtbar beim Login)</li>
          <li>Login mit deinen Account-Daten im Browser — Cookies werden im Profile-Dir persistiert und automatisch wiederverwendet</li>
          <li>Nach erfolgreichem Login: Browser schließt sich automatisch, Session-Badge wird grün</li>
        </ol>
        <div className="mt-2 text-amber-300/80">
          <span className="font-semibold">☁️ Cloudflare-Marketplaces</span> (Depop, Grailed, Vestiaire): es kann ein <em>Turnstile</em>-Captcha
          erscheinen — einfach lösen, dann läuft der Login weiter. <strong>Wenn Cloudflare deine IP hart blockt</strong>: VPN
          aus, kurz warten, oder andere Region versuchen.
        </div>
        <div className="mt-1 text-amber-300/80">
          <span className="font-semibold">📘 FB Marketplace</span> ist am restriktivsten (oft SMS-2FA, langsamer Login).
          <span className="font-semibold"> 🛒 eBay</span> nutzt OAuth — einmal einloggen, danach läuft alles per API ohne Browser.
        </div>
      </div>

      {/* Create — pick a platform first, label second. The platform choice
          drives the marketplace column on the new row so the bot pipelines
          can filter correctly. */}
      <div id="create-account-form" className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Neuen Account anlegen
        </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm">
        <select
          className="input shrink-0"
          value={newPlatform}
          onChange={(e) => setNewPlatform(e.target.value)}
          aria-label="Plattform"
          title="Marktplatz auswählen"
        >
          {ACCOUNT_PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          className="input flex-1 min-w-[160px]"
          placeholder={`Account-Name (z.B. "Alex-${ACCOUNT_PLATFORMS.find(p => p.id === newPlatform)?.label ?? 'Vinted'}")`}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createNew();
          }}
        />
        <button
          className="btn-primary"
          onClick={() => void createNew()}
          disabled={busy !== null || newLabel.trim() === ''}
        >
          {busy === 'create' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Anlegen
        </button>
      </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="mr-2 animate-spin" size={18} /> Lädt…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => {
            const brand = getBrand(group.marketplace);
            return (
              <section key={group.marketplace} className="space-y-2.5">
                {showSections && (
                  <div className="flex items-center gap-2 px-1">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${brand.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${brand.dot}`} />
                      {brand.label}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {group.accounts.length} Account{group.accounts.length === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
                {group.accounts.map((acc) => {
                  const isCurrent = acc.id === currentId;
                  const accBrand = getBrand(acc.marketplace ?? group.marketplace);
                  const hasProxy = typeof acc.proxy_url === 'string' && acc.proxy_url.length > 0;
                  return (
                    <div
                      key={acc.id}
                      className={`rounded-lg border bg-zinc-900/60 shadow-sm transition ${
                        isCurrent
                          ? 'border-brand-400 ring-1 ring-brand-100'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <UserCircle2
                    size={36}
                    className={acc.logged_in ? 'text-brand-500' : 'text-slate-300'}
                  />
                  <div className="min-w-0 flex-1">
                    {editingId === acc.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="input"
                          value={editLabel}
                          autoFocus
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void rename(acc.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button
                          className="btn-secondary"
                          onClick={() => void rename(acc.id)}
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-zinc-100">
                          {acc.label}
                        </div>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
                            <Star size={9} /> aktiv
                          </span>
                        )}
                        {hasProxy ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                            title={acc.proxy_url ?? ''}
                          >
                            <Shield size={9} /> Proxy aktiv
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/30"
                            title="Kein Proxy konfiguriert — Vinted erkennt evtl. die Datacenter-IP."
                          >
                            <ShieldAlert size={9} /> Kein Proxy
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-400">
                      {acc.username ? (
                        <span>@{acc.username}</span>
                      ) : (
                        <span className="italic">noch nicht eingeloggt</span>
                      )}
                      <span
                        className={
                          acc.logged_in
                            ? 'text-rose-600'
                            : 'text-amber-600'
                        }
                      >
                        {acc.logged_in ? 'Session gültig' : 'Kein Login'}
                      </span>
                      <span>{acc.active ? 'Pipeline: an' : 'Pipeline: aus'}</span>
                    </div>
                  </div>
                </div>
                <div className="absolute right-3 top-3 hidden">{/* legacy slot */}</div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`hidden md:inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${accBrand.chip}`}
                    title={accBrand.label}
                  >
                    {accBrand.short}
                  </span>
                  <button
                    className="btn-secondary"
                    title="Proxy konfigurieren"
                    disabled={busy !== null}
                    onClick={() => setProxyForAccountId(acc.id)}
                  >
                    <Lock size={13} className={hasProxy ? 'text-emerald-400' : 'text-zinc-500'} />
                  </button>
                  {!isCurrent && (
                    <button
                      className="btn-secondary"
                      title="Als aktiven Account setzen"
                      disabled={busy !== null}
                      onClick={() => void makeCurrent(acc.id)}
                    >
                      <Star size={13} />
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    title={acc.active ? 'Pipeline pausieren' : 'Pipeline aktivieren'}
                    disabled={busy !== null}
                    onClick={() => void toggleActive(acc)}
                  >
                    <Power
                      size={13}
                      className={acc.active ? 'text-rose-500' : 'text-zinc-500'}
                    />
                  </button>
                  <button
                    className="btn-secondary"
                    title="Umbenennen"
                    disabled={busy !== null}
                    onClick={() => {
                      setEditingId(acc.id);
                      setEditLabel(acc.label);
                    }}
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    className="rounded-md border border-red-200 px-2 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title="Löschen"
                    disabled={busy !== null || accounts.length <= 1}
                    onClick={() => void remove(acc)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* ── Account Metrics (Follower / Rating / Wallet / Today) ───────── */}
              <AccountMetricsCard accountId={acc.id} />

              {/* ── Marketplace Login Grid ─────────────────────── */}
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <Globe size={11} /> Plattform-Logins
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MARKETPLACE_LOGINS.map((mp) => {
                    const loginKey = `login:${acc.id}:${mp.id}`;
                    const isLoggingIn = busy === loginKey;
                    const titleAttr = [
                      `Bei ${mp.label} anmelden`,
                      mp.cloudflare ? '⚠ Cloudflare-geschützt — bei Turnstile-Captcha solven' : null,
                      mp.authNote,
                    ].filter(Boolean).join(' · ');
                    return (
                      <button
                        key={mp.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:shadow-sm disabled:opacity-40 ${
                          mp.id === 'vinted' && acc.logged_in
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/40'
                        }`}
                        disabled={busy !== null}
                        title={titleAttr}
                        onClick={async () => {
                          // API-only marketplaces don't open a browser — route the user
                          // to the credentials panel instead of POSTing to a route that
                          // would return 400 ("not browser login").
                          if (mp.apiOnly) {
                            try { localStorage.setItem('br_settings_tab', 'api-auth'); } catch { /* ignore */ }
                            navigate('/settings');
                            toast.info(`${mp.label}: API-Keys eintragen`, {
                              detail: 'Kein Browser-Login — bitte API-Token in den Einstellungen hinterlegen.',
                            });
                            return;
                          }
                          setBusy(loginKey);
                          try {
                            const url = mp.loginPath.replace('{id}', String(acc.id));
                            await api.post(url);
                            const detail = mp.cloudflare
                              ? 'Cloudflare-Captcha kann erscheinen — bitte solven. Session wird gespeichert.'
                              : mp.risk === 'high'
                              ? 'High-Risk-Plattform — separater Account empfohlen. Session wird gespeichert.'
                              : 'Bitte einloggen — Session wird automatisch gespeichert.';
                            toast.info(`${mp.label}: Browser-Fenster öffnet sich`, { detail });
                          } catch (err) {
                            // api.post throws on non-2xx with the orchestrator's error
                            // message. 502 (bot proxy) and 'unreachable' get the
                            // bot-down treatment; everything else stays generic.
                            const errText = err instanceof Error ? err.message : String(err);
                            if (/HTTP 502|unreachable|bot unreachable/i.test(errText)) {
                              toast.error(`${mp.label}-Bot läuft nicht`, {
                                detail: 'Settings → Diagnose → „Services neu starten" oder Bot manuell hochfahren.',
                              });
                            } else {
                              toast.error(`${mp.label} Login fehlgeschlagen`, { detail: errText });
                            }
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {isLoggingIn ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <span>{mp.emoji}</span>
                        )}
                        {mp.label}
                        {mp.cloudflare && <span className="ml-0.5 text-[9px] opacity-60" title="Cloudflare">☁️</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      {/* ProxySettingsModal owns the form/test/save flow per account. We
          just feed it the current proxy_url so the input pre-fills. */}
      {proxyForAccountId !== null && (() => {
        const acc = accounts.find((a) => a.id === proxyForAccountId) ?? null;
        return (
          <ProxySettingsModal
            accountId={proxyForAccountId}
            currentProxyUrl={acc?.proxy_url ?? null}
            onClose={() => setProxyForAccountId(null)}
            onSave={() => {
              setProxyForAccountId(null);
              void load();
            }}
          />
        );
      })()}
    </div>
  );
}
