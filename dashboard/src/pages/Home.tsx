import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Rocket,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useMarketplace } from '../components/MarketplaceContext';
import { CashTracker } from '../components/CashTracker';
import { CountUp } from '../components/CountUp';
import { HomeTrendsChart } from '../components/HomeTrendsChart';
import { fmtNum } from '../lib/format';
import { getBrand } from '../lib/marketplace';

interface MarketplaceState {
  // Any marketplace id from /api/home/status — including the 14 beyond the
  // original Vinted/KA/eBay-DE triplet. UI handles unknown ids via getBrand().
  id: string;
  label: string;
  enabled: boolean;
  loggedIn: boolean;
  liveListings: number;
  failedListings: number;
}

interface HomeStatus {
  paused: boolean;
  dailyCap: number;
  publishedToday: number;
  approved: number;
  draft: number;
  publishing: number;
  published: number;
  failed: number;
  liveOnVinted: number;
  pendingOffers: number;
  unreadChats: number;
  soldNotShipped: number;
  vintedLoggedIn: boolean;
  vintedUsername: string | null;
  cjConfigured: boolean;
  cjPendingOrders: number;
  cjFailedOrders: number;
  marketplaces: MarketplaceState[];
}

function StatusCard({
  state,
  title,
  detail,
  action,
}: {
  state: 'good' | 'warn' | 'bad';
  title: string;
  detail: string;
  action?: { label: string; onClick?: () => void; to?: string };
}) {
  // One accent palette — `good` lands on ruby/violet (the brand), warn on
  // amber for real attention, bad on rose for failures. No emerald anywhere.
  const Icon = state === 'good' ? CheckCircle2 : state === 'warn' ? AlertTriangle : XCircle;
  const ringClass =
    state === 'good' ? 'ring-zinc-800 bg-zinc-900/60'
    : state === 'warn' ? 'ring-amber-500/30 bg-amber-500/5'
    : 'ring-rose-500/30 bg-rose-500/5';
  const iconClass =
    state === 'good' ? 'text-rose-300'
    : state === 'warn' ? 'text-amber-400'
    : 'text-rose-400';
  return (
    <div className={`card ring-1 ${ringClass} flex items-center gap-4`}>
      <Icon size={28} className={iconClass} strokeWidth={2.2} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        <div className="text-xs text-zinc-400 truncate">{detail}</div>
      </div>
      {action && (
        action.to
          ? <Link to={action.to} className="btn-secondary text-xs">{action.label}</Link>
          : <button onClick={action.onClick} className="btn-secondary text-xs">{action.label}</button>
      )}
    </div>
  );
}

function MarketplaceCard({
  mp,
  onToggle,
}: {
  mp: MarketplaceState;
  onToggle: () => void | Promise<void>;
}) {
  const isVinted = mp.id === 'vinted';
  const brand = getBrand(mp.id);
  const Icon = brand.icon;
  return (
    <div className={`relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br ${brand.gradient} p-5 transition hover:border-zinc-700 hover:shadow-xl hover:shadow-black/30`}>
      {/* corner glow */}
      <div className={`pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full ${brand.bgTint} blur-2xl`} />

      <div className="relative flex items-center gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${brand.bgTint} ring-1 ${brand.ring}`}>
          <Icon size={20} strokeWidth={2.1} className={brand.text} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-100">{brand.label}</span>
            {mp.loggedIn ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 ring-1 ring-zinc-700">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                eingeloggt
              </span>
            ) : (
              <span className="badge-warn">Login fehlt</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">
            <span className={`font-semibold ${brand.text}`}>{mp.liveListings}</span> live
            {mp.failedListings > 0 && <> · <span className="text-rose-300">{mp.failedListings} failed</span></>}
            {' · '}
            {mp.enabled ? 'Auto-Crosslist an' : 'Auto-Crosslist aus'}
          </div>
        </div>
        {!isVinted && (
          <button
            onClick={() => void onToggle()}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              mp.enabled
                ? `${brand.bgTint} ${brand.text} ring-1 ${brand.ring} hover:brightness-125`
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {mp.enabled ? 'Aktiv' : 'Aktivieren'}
          </button>
        )}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Activity;
  accent?: 'good' | 'warn' | 'bad' | 'info';
}) {
  // Single-accent palette: positive metrics stay neutral or use the ruby
  // brand color — warn/bad keep semantic amber/rose so problems pop.
  const accentClass =
    accent === 'good' ? 'text-zinc-100'
    : accent === 'warn' ? 'text-amber-400'
    : accent === 'bad' ? 'text-rose-400'
    : accent === 'info' ? 'text-rose-300'
    : 'text-zinc-300';
  return (
    <div className="card-hover">
      <div className="flex items-start justify-between">
        <div>
          <div className="kpi-label">{label}</div>
          <div className={`kpi-value mt-1 ${accentClass}`}>
            {typeof value === 'number'
              ? <CountUp value={value} format={(n) => fmtNum(Math.round(n))} />
              : value}
          </div>
          {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
        </div>
        <Icon size={20} className="text-zinc-600" />
      </div>
    </div>
  );
}

export function HomePage() {
  const { marketplace, query } = useMarketplace();
  const [status, setStatus] = useState<HomeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.get<HomeStatus>(`/home/status${query}`);
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchStatus();
    const t = setInterval(() => void fetchStatus(), 10_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const handleStart = async () => {
    if (!status) return;
    setStarting(true);
    try {
      await api.post<{ ok: boolean; message: string }>('/home/start-bulk', {});
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleTogglePause = async () => {
    if (!status) return;
    try {
      await api.post<{ ok: boolean }>('/home/pause', { paused: !status.paused });
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading || !status) {
    return (
      <div className="space-y-7 fade-in">
        <div className="flex items-end justify-between">
          <div>
            <div className="skeleton h-9 w-32" />
            <div className="skeleton mt-2 h-4 w-64" />
          </div>
          <div className="skeleton h-9 w-28 rounded-lg" />
        </div>
        <div className="skeleton h-44 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  const canStart =
    status.vintedLoggedIn &&
    status.approved > 0 &&
    !status.paused;

  const startReason = !status.vintedLoggedIn
    ? 'Vinted Login fehlt'
    : status.paused
    ? 'System ist pausiert'
    : status.approved === 0
    ? 'Keine approved Listings'
    : `${status.approved} ready · daily cap ${status.dailyCap}`;

  return (
    <div className="space-y-7">
      {/* Header — pause/resume button stays hidden when the global PauseBanner
          is already showing one. Avoids three identical buttons on screen. */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="page-subtitle">
            Hustle Engine —{' '}
            {marketplace === 'all'
              ? 'alle Marketplaces zusammen'
              : `nur ${marketplace === 'vinted' ? 'Vinted' : marketplace === 'kleinanzeigen' ? 'Kleinanzeigen' : 'eBay-DE'}`}
          </p>
        </div>
        {!status.paused && (
          <button
            onClick={handleTogglePause}
            className="btn-ghost"
            title="System pausieren"
          >
            <Pause size={16} />
            Pausieren
          </button>
        )}
      </div>

      {error && (
        <div className="card flex items-start gap-2.5 border-rose-500/40 bg-rose-500/5 text-sm text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Cash Tracker (das wichtigste!) ─────────────────────────────── */}
      <CashTracker query={query} />

      {/* ── Activity trends ────────────────────────────────────────────── */}
      <HomeTrendsChart days={14} />

      {/* ── Status row ─────────────────────────────────────────────────── */}
      <div>
        <div className="h-section mb-3">System-Status</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <StatusCard
            state={status.vintedLoggedIn ? 'good' : 'bad'}
            title="Vinted"
            detail={status.vintedLoggedIn ? `Eingeloggt als ${status.vintedUsername ?? '?'}` : 'Nicht eingeloggt'}
            action={!status.vintedLoggedIn ? { label: 'Login', to: '/settings' } : undefined}
          />
          <StatusCard
            state={status.cjConfigured ? 'good' : 'warn'}
            title="CJ Dropshipping"
            detail={status.cjConfigured
              ? `Verbunden · ${status.cjPendingOrders} offen${status.cjFailedOrders ? ` · ${status.cjFailedOrders} failed` : ''}`
              : 'API-Key fehlt'}
            action={!status.cjConfigured ? { label: 'Verbinden', to: '/settings' } : undefined}
          />
          <StatusCard
            state={status.paused ? 'warn' : 'good'}
            title="Auto-Publisher"
            detail={status.paused
              ? 'Pausiert — Banner oben klicken zum Fortsetzen'
              : `Aktiv · ${status.publishedToday}/${status.dailyCap} heute · ${status.publishing} läuft`}
          />
        </div>
      </div>

      {/* ── Marketplace Setup ──────────────────────────────────────────── */}
      {status.marketplaces && status.marketplaces.length > 0 && (
        <div>
          <div className="h-section mb-3">Marketplaces</div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {status.marketplaces.map((mp) => (
              <MarketplaceCard
                key={mp.id}
                mp={mp}
                onToggle={async () => {
                  if (mp.id === 'vinted') return;
                  try {
                    await api.post(`/home/marketplace/${mp.id}/toggle`, {});
                    await fetchStatus();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Big CTA ────────────────────────────────────────────────────── */}
      <div className="card-gradient p-10 flex flex-col items-center text-center gap-6 relative overflow-hidden">
        <Sparkles size={40} className="text-rose-400 opacity-80" />
        <div>
          <div className="kpi-value-lg">{status.approved}</div>
          <div className="kpi-label mt-1">Approved Listings · ready to ship</div>
        </div>
        <button
          onClick={handleStart}
          disabled={!canStart || starting}
          className={`btn-huge ${canStart && !starting ? 'glow-cta' : ''}`}
        >
          <Rocket size={22} />
          {starting ? 'Starte ...' : 'Alles listen jetzt'}
        </button>
        <div className="text-xs text-zinc-400">{startReason}</div>
      </div>

      {/* ── KPI grid ───────────────────────────────────────────────────── */}
      <div>
        <div className="h-section mb-3">KPIs</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            label={marketplace === 'all' ? 'Live insgesamt' : `Live auf ${marketplace === 'vinted' ? 'Vinted' : marketplace === 'kleinanzeigen' ? 'KA' : 'eBay'}`}
            value={status.liveOnVinted}
            icon={TrendingUp}
            accent="good"
          />
          <KpiTile label="Offene Angebote" value={status.pendingOffers} icon={Wallet} accent={status.pendingOffers > 0 ? 'info' : undefined} />
          <KpiTile label="Verkauft & nicht versendet" value={status.soldNotShipped} icon={ShoppingCart} accent={status.soldNotShipped > 0 ? 'warn' : undefined} />
          <KpiTile label="Heute published" value={status.publishedToday} hint={`Cap ${status.dailyCap}/Tag`} icon={Zap} accent="info" />
        </div>
      </div>

      {/* ── Pipeline ───────────────────────────────────────────────────── */}
      <div>
        <div className="h-section mb-3">Pipeline</div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiTile label="Draft" value={status.draft} icon={Activity} />
          <KpiTile label="Approved" value={status.approved} icon={Activity} accent="info" />
          <KpiTile label="Publishing" value={status.publishing} icon={Activity} accent={status.publishing > 0 ? 'warn' : undefined} />
          <KpiTile label="Published" value={status.published} icon={Activity} accent="good" />
          <KpiTile label="Failed" value={status.failed} icon={Activity} accent={status.failed > 0 ? 'bad' : undefined} />
        </div>
      </div>
    </div>
  );
}
