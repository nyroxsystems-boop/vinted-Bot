import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import {
  Package, Truck, CheckCircle, AlertCircle, Clock, Search,
  RefreshCw, DollarSign, TrendingUp, ExternalLink,
} from 'lucide-react';

interface CJOrder {
  id: number;
  sale_id: number;
  cj_order_id: string | null;
  cj_order_number: string | null;
  status: string;
  tracking_number: string | null;
  logistic_name: string | null;
  cost_total_eur: number | null;
  ordered_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  error: string | null;
  buyer_name: string;
  listing_title: string;
  sell_price_eur: number;
  cost_eur: number | null;
}

interface ProfitSummary {
  total_orders: number;
  delivered: number;
  in_transit: number;
  ordered: number;
  failed: number;
  total_cost_eur: number;
  total_revenue_eur: number;
  total_profit_eur: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; label: string }> = {
  pending:   { icon: Clock,       color: 'text-amber-500 bg-amber-50',   label: 'Wartend' },
  ordered:   { icon: Package,     color: 'text-blue-500 bg-blue-50',     label: 'Bestellt' },
  shipping:  { icon: Truck,       color: 'text-rose-500 bg-rose-50', label: 'Unterwegs' },
  delivered: { icon: CheckCircle, color: 'text-rose-500 bg-rose-50', label: 'Geliefert' },
  failed:    { icon: AlertCircle, color: 'text-red-500 bg-red-50',       label: 'Fehlgeschlagen' },
  cancelled: { icon: AlertCircle, color: 'text-slate-400 bg-slate-50',   label: 'Storniert' },
};

export function CJOrdersPage() {
  const [orders, setOrders] = useState<CJOrder[]>([]);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, profitRes] = await Promise.all([
        api.get<{ ok: boolean; orders: CJOrder[] }>('/cj/orders'),
        api.get<ProfitSummary & { ok: boolean }>('/cj/profit'),
      ]);
      setOrders(ordersRes.orders ?? []);
      setProfit(profitRes);
    } catch (err) {
      console.error('CJ data load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CJ Dropshipping</h1>
          <p className="text-sm text-slate-500">Bestellungen, Tracking & Profit-Übersicht</p>
        </div>
        <button
          onClick={() => void load()}
          className="btn-secondary inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} />
          Aktualisieren
        </button>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      {profit && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KPICard
            icon={Package}
            label="Bestellungen"
            value={profit.total_orders}
            color="bg-blue-50 text-blue-600"
          />
          <KPICard
            icon={Truck}
            label="Unterwegs"
            value={profit.in_transit}
            color="bg-rose-50 text-rose-600"
          />
          <KPICard
            icon={DollarSign}
            label="Umsatz"
            value={`€${profit.total_revenue_eur.toFixed(0)}`}
            color="bg-rose-50 text-rose-600"
          />
          <KPICard
            icon={TrendingUp}
            label="Profit"
            value={`€${profit.total_profit_eur.toFixed(0)}`}
            color="bg-amber-50 text-amber-600"
          />
        </div>
      )}

      {/* ── Filter Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {[
          { key: 'all', label: 'Alle' },
          { key: 'pending', label: 'Wartend' },
          { key: 'ordered', label: 'Bestellt' },
          { key: 'shipping', label: 'Unterwegs' },
          { key: 'delivered', label: 'Geliefert' },
          { key: 'failed', label: 'Fehler' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1 text-[10px] text-slate-400">
                {orders.filter((o) => o.status === tab.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Orders Table ───────────────────────────────────────────────── */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Lade CJ-Bestellungen…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {orders.length === 0
              ? 'Noch keine CJ-Bestellungen. Sobald ein Sale bezahlt wird, wird automatisch bei CJ bestellt.'
              : 'Keine Bestellungen in diesem Filter.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Artikel</th>
                <th className="px-4 py-3">Käufer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3 text-right">EK</th>
                <th className="px-4 py-3 text-right">VK</th>
                <th className="px-4 py-3 text-right">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((order) => {
                const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending!;
                const StatusIcon = cfg!.icon;
                const profit = order.sell_price_eur && order.cost_eur
                  ? order.sell_price_eur - order.cost_eur
                  : null;
                return (
                  <tr key={order.id} className="hover:bg-slate-25 transition">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      #{order.sale_id}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {order.listing_title?.slice(0, 35) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{order.buyer_name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                        <StatusIcon size={12} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {order.tracking_number ? (
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-blue-600">
                          {order.tracking_number}
                          <ExternalLink size={10} />
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">
                      {order.cost_eur ? `€${order.cost_eur.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                      €{order.sell_price_eur?.toFixed(2) ?? '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${
                      profit && profit > 0 ? 'text-rose-600' : 'text-red-500'
                    }`}>
                      {profit !== null ? `€${profit.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KPICard(props: {
  icon: typeof Package;
  label: string;
  value: string | number;
  color: string;
}) {
  const Icon = props.icon;
  return (
    <div className="card flex items-center gap-3">
      <div className={`rounded-lg p-2 ${props.color}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {props.label}
        </div>
        <div className="text-lg font-semibold text-slate-900">{props.value}</div>
      </div>
    </div>
  );
}
