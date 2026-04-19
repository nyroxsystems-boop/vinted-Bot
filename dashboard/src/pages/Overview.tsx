import { Link } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Package,
  HandCoins,
  Truck,
  AlertCircle,
  Pause,
  Play,
  ShoppingCart,
  TrendingUp,
  KeyRound,
} from 'lucide-react';
import { useStatus } from '../hooks/useStatus';
import { useSettings } from '../hooks/useSettings';
import { useDaily } from '../hooks/useAnalytics';
import { useAuthStatus } from '../hooks/useAuth';
import { anyBotNeedsLogin } from '../components/AuthPanel';

export function OverviewPage() {
  const { data, error } = useStatus();
  const { settings, update } = useSettings();
  const { data: daily } = useDaily(14);
  const { data: auth } = useAuthStatus(5000);

  const paused = settings.paused === 'true';
  const loginNeeded = auth ? anyBotNeedsLogin(auth) : null;

  const totals = daily.reduce(
    (a, d) => ({ paid: a.paid + d.paid, revenue: a.revenue + d.revenue_eur }),
    { paid: 0, revenue: 0 },
  );

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Übersicht</h1>
          <p className="mt-1 text-sm text-slate-500">
            {paused
              ? 'System ist pausiert — Bots machen nichts.'
              : 'System läuft — Bots pollen Vinted automatisch.'}
          </p>
        </div>
        <button
          className={paused ? 'btn-primary' : 'btn-danger'}
          onClick={() => update({ paused: paused ? 'false' : 'true' })}
        >
          {paused ? (
            <>
              <Play size={14} /> System starten
            </>
          ) : (
            <>
              <Pause size={14} /> PAUSIEREN
            </>
          )}
        </button>
      </div>

      {error && <div className="card text-red-600">{error}</div>}

      {loginNeeded && (
        <Link
          to="/settings"
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <KeyRound size={18} />
          <div className="flex-1">
            <div className="font-semibold">Login benötigt</div>
            <div className="text-xs">
              {loginNeeded === 'both'
                ? 'Vinted- und Temu-Session sind abgelaufen oder nie eingerichtet.'
                : loginNeeded === 'vinted'
                  ? 'Vinted-Session ist abgelaufen oder nie eingerichtet.'
                  : 'Temu-Session ist abgelaufen oder nie eingerichtet.'}{' '}
              → Einstellungen öffnen.
            </div>
          </div>
        </Link>
      )}

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi
          icon={<Package size={16} />}
          label="Aktive Listings"
          value={data?.kpis.active_listings ?? 0}
          to="/listings"
        />
        <Kpi
          icon={<HandCoins size={16} />}
          label="Offene Angebote"
          value={data?.kpis.pending_offers ?? 0}
          to="/offers"
          emphasis={(data?.kpis.pending_offers ?? 0) > 0}
        />
        <Kpi
          icon={<ShoppingCart size={16} />}
          label="Wartend auf Fulfillment"
          value={data?.kpis.pending_sales ?? 0}
          to="/fulfillment"
          emphasis={(data?.kpis.pending_sales ?? 0) > 0}
        />
        <Kpi
          icon={<Truck size={16} />}
          label="Temu offen"
          value={data?.kpis.open_temu_orders ?? 0}
          to="/orders"
        />
        <Kpi
          icon={<AlertCircle size={16} />}
          label="Fehler"
          value={data?.kpis.failed_temu_orders ?? 0}
          to="/orders"
          danger={(data?.kpis.failed_temu_orders ?? 0) > 0}
        />
      </div>

      {/* ── 14-day mini chart ────────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-50 text-brand-700">
              <TrendingUp size={16} />
            </div>
            <h2 className="font-semibold">Umsatz · letzte 14 Tage</h2>
          </div>
          <Link to="/analytics" className="text-xs font-medium text-brand-600 hover:underline">
            Analytics öffnen →
          </Link>
        </div>
        <div className="mb-3 flex gap-6 text-sm">
          <span>
            <span className="text-slate-500">Umsatz:</span>{' '}
            <span className="font-bold">€{totals.revenue.toFixed(2)}</span>
          </span>
          <span>
            <span className="text-slate-500">Verkäufe:</span>{' '}
            <span className="font-bold">{totals.paid}</span>
          </span>
        </div>
        <div className="h-32">
          <ResponsiveContainer>
            <AreaChart data={daily} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ov-rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                formatter={(v: number) => `€${v.toFixed(2)}`}
                labelFormatter={(l) => `Tag: ${l}`}
                contentStyle={{ fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="revenue_eur"
                stroke="#3b82f6"
                fill="url(#ov-rev)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Bot status cards ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <BotCard title="Vinted-Bot" status={data?.bots.vinted} />
        <BotCard title="Temu-Bot" status={data?.bots.temu} />
      </div>
    </div>
  );
}

function Kpi(props: {
  icon: JSX.Element;
  label: string;
  value: number;
  to?: string;
  danger?: boolean;
  emphasis?: boolean;
}) {
  const inner = (
    <div
      className={`card transition ${
        props.to ? 'cursor-pointer hover:shadow-md' : ''
      } ${props.emphasis ? 'border-amber-300 bg-amber-50/50' : ''}`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-slate-500">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100">
          {props.icon}
        </span>
        <span className="label m-0">{props.label}</span>
      </div>
      <div className={`text-3xl font-bold ${props.danger ? 'text-red-600' : 'text-slate-900'}`}>
        {props.value}
      </div>
    </div>
  );
  return props.to ? <Link to={props.to}>{inner}</Link> : inner;
}

function BotCard(props: { title: string; status: unknown }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{props.title}</h2>
      </div>
      <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
        {JSON.stringify(props.status, null, 2)}
      </pre>
    </div>
  );
}
