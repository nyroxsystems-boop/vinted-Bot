import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Activity, TrendingUp, Package, AlertTriangle,
  Clock, Zap, Eye, Heart, MessageSquare,
  ArrowRight, Truck, ShoppingBag, RefreshCw, Shield,
} from 'lucide-react';
import { getBrand, MARKETPLACE_BRANDS, type MarketplaceId } from '../lib/marketplace';
import { fmtEur, fmtNum, fmtTime } from '../lib/format';
import { CountUp } from '../components/CountUp';

// ── Types ────────────────────────────────────────────────────────────────────

interface BotHealth {
  marketplace: string;
  online: boolean;
  latencyMs?: number;
}

interface MpSummary {
  marketplace: string;
  counts: Array<{ status: string; n: number }>;
  totals: { views: number; likes: number; messages: number };
}

interface CjStats {
  total_orders: number;
  delivered: number;
  in_transit: number;
  ordered: number;
  pending: number;
  failed: number;
  avg_delivery_days: number | null;
}

interface ProfitTotals {
  total_sales: number;
  total_revenue: number;
  total_profit: number;
}

const ALL_MARKETPLACES = Object.keys(MARKETPLACE_BRANDS) as MarketplaceId[];

export function PlatformOverview() {
  const [botHealth, setBotHealth] = useState<BotHealth[]>([]);
  const [summaries, setSummaries] = useState<Record<string, MpSummary>>({});
  const [profitTotals, setProfitTotals] = useState<ProfitTotals | null>(null);
  const [cjStats, setCjStats] = useState<CjStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, profitRes] = await Promise.all([
        api.get<{ marketplaces: BotHealth[] }>('/products/marketplaces/health'),
        api.get<{
          ok: boolean;
          totals: ProfitTotals;
          cjStats: CjStats;
        }>('/profit/summary'),
      ]);

      setBotHealth(healthRes.marketplaces ?? []);
      setProfitTotals(profitRes.totals);
      setCjStats(profitRes.cjStats);

      const sums: Record<string, MpSummary> = {};
      const sumResults = await Promise.allSettled(
        ALL_MARKETPLACES.map(async (mp) => {
          const s = await api.get<MpSummary>(`/products/marketplace/${mp}/summary`);
          return { mp, summary: s };
        }),
      );
      for (const r of sumResults) {
        if (r.status === 'fulfilled') sums[r.value.mp] = r.value.summary;
      }
      setSummaries(sums);
      setLastRefresh(new Date());
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const onlineCount = botHealth.filter((b) => b.online).length;
  const offlineCount = botHealth.filter((b) => !b.online).length;

  const totalActiveListings = Object.values(summaries).reduce((sum, s) => {
    const active = s.counts?.find((c) => c.status === 'active')?.n ?? 0;
    return sum + active;
  }, 0);

  const totalViews = Object.values(summaries).reduce((sum, s) => sum + (s.totals?.views ?? 0), 0);
  const totalLikes = Object.values(summaries).reduce((sum, s) => sum + (s.totals?.likes ?? 0), 0);
  const totalMessages = Object.values(summaries).reduce((sum, s) => sum + (s.totals?.messages ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Platform Command Center</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Echtzeit-Überblick über alle {ALL_MARKETPLACES.length} Marktplätze
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">
            Aktualisiert {fmtTime(lastRefresh)}
          </span>
          <button onClick={() => void load()} disabled={loading} className="btn-secondary text-xs">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Lädt…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <MiniKPI icon={Activity}      label="Bots Online"  value={`${onlineCount}/${ALL_MARKETPLACES.length}`} color={offlineCount === 0 ? 'text-rose-300' : 'text-amber-300'} />
        <MiniKPI icon={Package}       label="Live Listings" value={totalActiveListings} color="text-blue-300" />
        <MiniKPI icon={Eye}           label="Views"         value={totalViews}          color="text-zinc-300" />
        <MiniKPI icon={Heart}         label="Likes"         value={totalLikes}          color="text-rose-300" />
        <MiniKPI icon={MessageSquare} label="Nachrichten"   value={totalMessages}       color="text-rose-300" />
        <MiniKPI icon={TrendingUp}    label="Profit"        value={profitTotals?.total_profit != null ? fmtEur(profitTotals.total_profit) : '—'} color="text-rose-300" />
        <MiniKPI icon={Truck}         label="CJ Transit"    value={cjStats?.in_transit ?? 0} color="text-rose-300" />
        <MiniKPI icon={Zap}           label="Sales"         value={profitTotals?.total_sales ?? 0} color="text-amber-300" />
      </div>

      {/* System Health Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Bot-Status</span>
        {ALL_MARKETPLACES.map((mp) => {
          const health = botHealth.find((b) => b.marketplace === mp);
          const brand = getBrand(mp);
          const Icon = brand.icon;
          return (
            <Link
              key={mp}
              to={`/marketplace/${mp}`}
              className="group relative"
              title={`${brand.label}: ${health?.online ? 'online' : 'offline'}`}
            >
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition group-hover:scale-110 ${
                health?.online ? `${brand.bgTint} ring-1 ${brand.ring}` : 'bg-zinc-800 ring-1 ring-zinc-700'
              }`}>
                <Icon size={14} className={health?.online ? brand.text : 'text-zinc-600'} strokeWidth={2.4} />
              </span>
              <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-zinc-950 ${
                health?.online ? 'bg-rose-400' : 'bg-rose-400'
              }`} />
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-rose-300">
            <span className="dot-good dot-pulse" /> {onlineCount} online
          </span>
          {offlineCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-rose-300">
              <span className="dot-bad" /> {offlineCount} offline
            </span>
          )}
        </div>
      </div>

      {/* Marketplace Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ALL_MARKETPLACES.map((mp) => {
          const brand = getBrand(mp);
          const Icon = brand.icon;
          const health = botHealth.find((b) => b.marketplace === mp);
          const summary = summaries[mp];
          const active     = summary?.counts?.find((c) => c.status === 'active')?.n ?? 0;
          const sold       = summary?.counts?.find((c) => c.status === 'sold')?.n ?? 0;
          const failed     = summary?.counts?.find((c) => c.status === 'failed')?.n ?? 0;
          const publishing = summary?.counts?.find((c) => c.status === 'publishing')?.n ?? 0;
          const views      = summary?.totals?.views ?? 0;
          const likes      = summary?.totals?.likes ?? 0;

          return (
            <Link
              key={mp}
              to={`/marketplace/${mp}`}
              className={`group relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br ${brand.gradient} transition hover:border-zinc-700 hover:shadow-xl hover:shadow-black/30`}
            >
              <div className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full ${brand.bgTint} blur-3xl opacity-60`} />

              <div className="relative flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className={`grid h-8 w-8 place-items-center rounded-lg ${brand.bgTint} ring-1 ${brand.ring}`}>
                    <Icon size={15} className={brand.text} strokeWidth={2.4} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-100">{brand.label}</span>
                    {brand.cloudflareProtected && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-amber-300/80" title="Cloudflare Bot Protection">
                        <Shield size={8} /> Cloudflare
                      </span>
                    )}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${
                  health?.online ? 'text-rose-300' : 'text-rose-300'
                }`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${health?.online ? 'bg-rose-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-rose-400'}`} />
                  {health?.online ? 'Online' : 'Offline'}
                </span>
              </div>

              <div className="relative space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-rose-500/5 px-3 py-2 ring-1 ring-rose-500/20">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-rose-400/80">Aktiv</div>
                    <div className="text-xl font-bold tabular text-rose-300">
                      <CountUp value={active} format={(n) => fmtNum(Math.round(n))} />
                    </div>
                  </div>
                  <div className="rounded-lg bg-blue-500/5 px-3 py-2 ring-1 ring-blue-500/20">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-400/80">Verkauft</div>
                    <div className="text-xl font-bold tabular text-blue-300">
                      <CountUp value={sold} format={(n) => fmtNum(Math.round(n))} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="inline-flex items-center gap-1"><Eye size={11} className="text-zinc-500" /> {fmtNum(views)}</span>
                  <span className="inline-flex items-center gap-1"><Heart size={11} className="text-zinc-500" /> {fmtNum(likes)}</span>
                  {failed > 0 && (
                    <span className="inline-flex items-center gap-1 text-rose-300">
                      <AlertTriangle size={11} /> {failed}
                    </span>
                  )}
                  {publishing > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-300">
                      <Clock size={11} /> {publishing}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end text-[10px] font-semibold text-zinc-500 transition group-hover:text-zinc-300">
                  Details <ArrowRight size={11} className="ml-1" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* CJ Pipeline + Workers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
              <ShoppingBag size={16} className="text-rose-300" /> CJ Fulfillment Pipeline
            </h2>
            <Link to="/cj/orders" className="text-[11px] text-rose-300 hover:underline">
              Alle Bestellungen →
            </Link>
          </div>
          {cjStats ? (
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Wartend',   val: cjStats.pending,    color: 'bg-amber-500/10 text-amber-300 ring-amber-500/30' },
                { label: 'Bestellt',  val: cjStats.ordered,    color: 'bg-blue-500/10 text-blue-300 ring-blue-500/30' },
                { label: 'Unterwegs', val: cjStats.in_transit, color: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
                { label: 'Geliefert', val: cjStats.delivered,  color: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
                { label: 'Fehler',    val: cjStats.failed,     color: 'bg-rose-500/10 text-rose-300 ring-rose-500/30' },
              ].map((s) => (
                <div key={s.label} className={`rounded-lg px-2 py-2 text-center ring-1 ${s.color}`}>
                  <div className="text-lg font-bold tabular">{fmtNum(s.val)}</div>
                  <div className="text-[9px] font-medium uppercase tracking-wider opacity-80">{s.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-zinc-500">Lade CJ-Daten…</div>
          )}
          {cjStats?.avg_delivery_days && (
            <div className="mt-3 text-center text-xs text-zinc-400">
              Ø Lieferzeit: <span className="font-semibold text-zinc-200">{cjStats.avg_delivery_days.toFixed(1)} Tage</span>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-zinc-100">
            <Activity size={16} className="text-blue-300" /> Automation Workers
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: 'CJ Fulfillment',     interval: '3 min',  critical: true },
              { name: 'Cross-Sync',         interval: '30 s',   critical: true },
              { name: 'Auto-Publisher',     interval: '60 s',   critical: false },
              { name: 'Sales Fulfillment',  interval: '5 min',  critical: false },
              { name: 'Repricer',           interval: '24 h',   critical: false },
              { name: 'Reply-Autopilot',    interval: '5 min',  critical: false },
              { name: 'Performance KPI',    interval: '24 h',   critical: false },
              { name: 'Listing Refresher',  interval: '4 h',    critical: false },
            ].map((w) => (
              <div key={w.name} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <span className={`h-2 w-2 rounded-full ${onlineCount > 0 ? 'bg-rose-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-zinc-600'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-zinc-200">{w.name}</div>
                  <div className="text-[9px] text-zinc-500">{w.interval}</div>
                </div>
                {w.critical && (
                  <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                    onlineCount > 0 ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30' : 'bg-zinc-800 text-zinc-500'
                  }`}>{onlineCount > 0 ? 'Live' : 'Off'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniKPI(props: { icon: typeof Activity; label: string; value: string | number; color: string }) {
  const Icon = props.icon;
  return (
    <div className="card flex flex-col items-center justify-center px-2 py-3 text-center">
      <Icon size={14} className={`mb-1 ${props.color}`} />
      <div className={`tabular text-base font-bold ${props.color}`}>
        {typeof props.value === 'number' ? <CountUp value={props.value} format={(n) => fmtNum(Math.round(n))} /> : props.value}
      </div>
      <div className="mt-0.5 text-[8px] font-medium uppercase tracking-wider text-zinc-500">{props.label}</div>
    </div>
  );
}
