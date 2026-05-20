import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import {
  TrendingUp, DollarSign, ShoppingCart, Package, Truck,
  CheckCircle, AlertCircle, BarChart3, Globe, Clock,
} from 'lucide-react';

interface ProfitData {
  totals: {
    total_sales: number;
    total_revenue: number;
    total_cost: number;
    total_shipping_cost: number;
    total_profit: number;
  };
  byMarketplace: Array<{
    marketplace: string;
    sales: number;
    revenue: number;
    cost: number;
    profit: number;
  }>;
  daily: Array<{
    day: string;
    sales: number;
    revenue: number;
    cost: number;
    profit: number;
  }>;
  cjStats: {
    total_orders: number;
    delivered: number;
    in_transit: number;
    ordered: number;
    pending: number;
    failed: number;
    avg_delivery_days: number | null;
  };
  topProducts: Array<{
    folder_num: number;
    title: string;
    sales: number;
    revenue: number;
    cost: number;
    profit: number;
    margin_pct: number;
  }>;
  activeListings: Array<{
    marketplace: string;
    count: number;
  }>;
}

interface PayoutData {
  payouts: Array<{
    marketplace: string;
    completed_sales: number;
    awaiting_payout: number;
    paid_out_eur: number;
    pending_payout_eur: number;
  }>;
}

const MP_LABELS: Record<string, string> = {
  vinted: 'Vinted',
  kleinanzeigen: 'Kleinanzeigen',
  mercari: 'Mercari',
  depop: 'Depop',
  wallapop: 'Wallapop',
  ebay_de: 'eBay DE',
  ebay_uk: 'eBay UK',
  etsy: 'Etsy',
  grailed: 'Grailed',
  fb_marketplace: 'FB Marketplace',
};

const MP_COLORS: Record<string, string> = {
  vinted: 'bg-rose-500',
  kleinanzeigen: 'bg-green-500',
  mercari: 'bg-red-500',
  depop: 'bg-rose-500',
  wallapop: 'bg-rose-500',
  ebay_de: 'bg-blue-500',
  ebay_uk: 'bg-blue-400',
  etsy: 'bg-orange-500',
  grailed: 'bg-gray-700',
  fb_marketplace: 'bg-rose-500',
};

export function ProfitDashboard() {
  const [data, setData] = useState<ProfitData | null>(null);
  const [payouts, setPayouts] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profitRes, payoutRes] = await Promise.all([
        api.get<ProfitData & { ok: boolean }>('/profit/summary'),
        api.get<PayoutData & { ok: boolean }>('/profit/payouts'),
      ]);
      setData(profitRes);
      setPayouts(payoutRes);
    } catch (err) {
      console.error('Profit data load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading || !data) {
    return <div className="card p-8 text-center text-slate-400">Lade Profit-Daten…</div>;
  }

  const maxRevenue = Math.max(...(data.daily.map((d) => d.revenue) || [1]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profit Dashboard</h1>
        <p className="text-sm text-slate-500">
          Echtzeit-Analyse über alle {data.byMarketplace.length} Marktplätze
        </p>
      </div>

      {/* ── Top KPI Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KPI icon={ShoppingCart} label="Verkäufe" value={data.totals.total_sales} color="bg-blue-50 text-blue-600" />
        <KPI icon={DollarSign} label="Umsatz" value={`€${data.totals.total_revenue.toFixed(0)}`} color="bg-rose-50 text-rose-600" />
        <KPI icon={Package} label="Einkauf" value={`€${data.totals.total_cost.toFixed(0)}`} color="bg-red-50 text-red-600" />
        <KPI icon={TrendingUp} label="Profit" value={`€${data.totals.total_profit.toFixed(0)}`} color="bg-amber-50 text-amber-600" />
        <KPI
          icon={BarChart3}
          label="Ø Marge"
          value={data.totals.total_revenue > 0
            ? `${((data.totals.total_profit / data.totals.total_revenue) * 100).toFixed(0)}%`
            : '—'}
          color="bg-rose-50 text-rose-600"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Revenue Chart (last 30 days) ────────────────────── */}
        <div className="card">
          <h2 className="mb-4 font-semibold">Umsatz & Profit (30 Tage)</h2>
          {data.daily.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Noch keine Verkaufsdaten</div>
          ) : (
            <div className="flex items-end gap-[2px]" style={{ height: 160 }}>
              {data.daily.map((d) => (
                <div key={d.day} className="group relative flex-1" title={`${d.day}: €${d.revenue}`}>
                  <div
                    className="w-full rounded-t bg-brand-200 transition group-hover:bg-brand-400"
                    style={{ height: `${(d.revenue / maxRevenue) * 100}%`, minHeight: 2 }}
                  />
                  <div
                    className="w-full bg-rose-500 transition"
                    style={{ height: `${(d.profit / maxRevenue) * 100}%`, minHeight: d.profit > 0 ? 1 : 0 }}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-brand-300" /> Umsatz</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-rose-500" /> Profit</span>
          </div>
        </div>

        {/* ── Marketplace Breakdown ───────────────────────────── */}
        <div className="card">
          <h2 className="mb-4 font-semibold">Nach Marktplatz</h2>
          <div className="space-y-3">
            {data.byMarketplace.map((mp) => {
              const pct = data.totals.total_revenue > 0 ? (mp.revenue / data.totals.total_revenue) * 100 : 0;
              return (
                <div key={mp.marketplace} className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${MP_COLORS[mp.marketplace] ?? 'bg-slate-400'}`} />
                  <div className="min-w-[100px] text-sm font-medium text-slate-700">
                    {MP_LABELS[mp.marketplace] ?? mp.marketplace}
                  </div>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className={`h-2 rounded-full ${MP_COLORS[mp.marketplace] ?? 'bg-slate-400'} transition-all`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono">
                    <span className="text-slate-600">€{mp.revenue.toFixed(0)}</span>
                    <span className="mx-1 text-slate-300">/</span>
                    <span className="font-semibold text-rose-600">€{mp.profit.toFixed(0)}</span>
                  </div>
                  <div className="w-12 text-right text-[10px] text-slate-400">
                    {mp.sales} Sales
                  </div>
                </div>
              );
            })}
            {data.byMarketplace.length === 0 && (
              <div className="py-4 text-center text-sm text-slate-400">Noch keine Verkäufe</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── CJ Fulfillment Status ──────────────────────────── */}
        <div className="card">
          <h2 className="mb-4 font-semibold">CJ Fulfillment</h2>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat icon={Clock} label="Wartend" value={data.cjStats.pending} color="text-amber-500" />
            <MiniStat icon={Package} label="Bestellt" value={data.cjStats.ordered} color="text-blue-500" />
            <MiniStat icon={Truck} label="Unterwegs" value={data.cjStats.in_transit} color="text-rose-500" />
            <MiniStat icon={CheckCircle} label="Geliefert" value={data.cjStats.delivered} color="text-rose-500" />
            <MiniStat icon={AlertCircle} label="Fehler" value={data.cjStats.failed} color="text-red-500" />
            <MiniStat
              icon={Globe}
              label="Ø Lieferzeit"
              value={data.cjStats.avg_delivery_days ? `${data.cjStats.avg_delivery_days.toFixed(1)}d` : '—'}
              color="text-slate-500"
            />
          </div>
        </div>

        {/* ── Payout Tracker ─────────────────────────────────── */}
        <div className="card">
          <h2 className="mb-4 font-semibold">Auszahlungen</h2>
          <div className="space-y-2">
            {payouts?.payouts.map((p) => (
              <div key={p.marketplace} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${MP_COLORS[p.marketplace] ?? 'bg-slate-400'}`} />
                  <span className="text-sm font-medium">{MP_LABELS[p.marketplace] ?? p.marketplace}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-rose-600 font-mono font-semibold">
                    €{p.paid_out_eur.toFixed(0)} ausgezahlt
                  </span>
                  {p.pending_payout_eur > 0 && (
                    <span className="text-amber-600 font-mono">
                      €{p.pending_payout_eur.toFixed(0)} ausstehend
                    </span>
                  )}
                </div>
              </div>
            ))}
            {(!payouts?.payouts || payouts.payouts.length === 0) && (
              <div className="py-4 text-center text-sm text-slate-400">Noch keine Auszahlungsdaten</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Top Products ─────────────────────────────────────── */}
      <div className="card overflow-hidden p-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">Top-Produkte nach Profit</h2>
        </div>
        {data.topProducts.length === 0 ? (
          <div className="p-8 text-center text-slate-400">Noch keine Verkaufsdaten</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Produkt</th>
                <th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Umsatz</th>
                <th className="px-4 py-3 text-right">EK</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3 text-right">Marge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.topProducts.map((p, i) => (
                <tr key={p.folder_num} className="hover:bg-slate-25 transition">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">{p.title?.slice(0, 35) ?? `Folder #${p.folder_num}`}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{p.sales}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">€{p.revenue.toFixed(0)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-red-500">€{p.cost.toFixed(0)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${
                    p.profit > 0 ? 'text-rose-600' : 'text-red-500'
                  }`}>
                    €{p.profit.toFixed(0)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${
                      p.margin_pct > 50 ? 'bg-rose-50 text-rose-700'
                        : p.margin_pct > 30 ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      {p.margin_pct?.toFixed(0) ?? '—'}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Active Listings Count ─────────────────────────────── */}
      <div className="card">
        <h2 className="mb-3 font-semibold">Aktive Listings nach Plattform</h2>
        <div className="flex flex-wrap gap-3">
          {data.activeListings.map((al) => (
            <div key={al.marketplace} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className={`h-2 w-2 rounded-full ${MP_COLORS[al.marketplace] ?? 'bg-slate-400'}`} />
              <span className="text-sm">{MP_LABELS[al.marketplace] ?? al.marketplace}</span>
              <span className="font-mono text-sm font-semibold text-slate-700">{al.count}</span>
            </div>
          ))}
          {data.activeListings.length === 0 && (
            <span className="text-sm text-slate-400">Keine aktiven Listings</span>
          )}
        </div>
      </div>
    </div>
  );
}

function KPI(props: { icon: typeof TrendingUp; label: string; value: string | number; color: string }) {
  const Icon = props.icon;
  return (
    <div className="card flex items-center gap-3">
      <div className={`rounded-lg p-2 ${props.color}`}><Icon size={18} /></div>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{props.label}</div>
        <div className="text-lg font-semibold text-slate-900">{props.value}</div>
      </div>
    </div>
  );
}

function MiniStat(props: { icon: typeof TrendingUp; label: string; value: string | number; color: string }) {
  const Icon = props.icon;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <Icon size={14} className={props.color} />
      <div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{props.label}</div>
        <div className="text-sm font-semibold text-slate-700">{props.value}</div>
      </div>
    </div>
  );
}
