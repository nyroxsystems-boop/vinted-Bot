import { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useDaily, useTopListings, useFunnel } from '../hooks/useAnalytics';
import { TrendingUp, Trophy, Filter } from 'lucide-react';

const WINDOW_OPTIONS = [
  { days: 7, label: '7T' },
  { days: 14, label: '14T' },
  { days: 30, label: '30T' },
  { days: 90, label: '90T' },
];

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data: daily } = useDaily(days);
  const { data: top } = useTopListings(days, 10);
  const { data: funnel } = useFunnel(days);

  const totals = daily.reduce(
    (acc, d) => ({
      offers: acc.offers + d.offers,
      accepted: acc.accepted + d.accepted,
      paid: acc.paid + d.paid,
      revenue: acc.revenue + d.revenue_eur,
    }),
    { offers: 0, accepted: 0, paid: 0, revenue: 0 },
  );

  const acceptRate = totals.offers > 0 ? (totals.accepted / totals.offers) * 100 : 0;
  const payRate = totals.accepted > 0 ? (totals.paid / totals.accepted) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Umsatz, Verkäufe, Bestseller und Conversion</p>
        </div>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.days}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                days === o.days ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
              onClick={() => setDays(o.days)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Umsatz" value={`€${totals.revenue.toFixed(2)}`} />
        <Kpi label="Verkäufe" value={String(totals.paid)} />
        <Kpi label="Offers → Accept" value={`${acceptRate.toFixed(0)}%`} />
        <Kpi label="Accept → Paid" value={`${payRate.toFixed(0)}%`} />
      </div>

      {/* ── Revenue + sales over time ────────────────────────────────────── */}
      <Card title="Umsatz & Verkäufe pro Tag" icon={<TrendingUp size={16} />}>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={daily} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="revenue_eur"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#revenue)"
                name="Umsatz €"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Offers vs accepts (daily) ──────────────────────────────────── */}
        <Card title="Angebote pro Tag" icon={<Filter size={16} />}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={daily} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="offers" fill="#cbd5e1" name="Eingegangen" />
                <Bar dataKey="accepted" fill="#3b82f6" name="Akzeptiert" />
                <Bar dataKey="paid" fill="#10b981" name="Bezahlt" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ── Funnel ─────────────────────────────────────────────────────── */}
        <Card title="Conversion-Funnel" icon={<Filter size={16} />}>
          {funnel ? (
            <FunnelDisplay funnel={funnel} />
          ) : (
            <div className="text-sm text-slate-400">Lade…</div>
          )}
        </Card>
      </div>

      {/* ── Best sellers ─────────────────────────────────────────────────── */}
      <Card title="Bestseller" icon={<Trophy size={16} />}>
        {top.length === 0 ? (
          <div className="text-sm text-slate-400">Noch keine Verkäufe im Fenster.</div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart
                data={top}
                layout="vertical"
                margin={{ top: 10, right: 20, bottom: 10, left: 140 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  dataKey="title"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={140}
                  tickFormatter={(t: string) => (t.length > 24 ? t.slice(0, 24) + '…' : t)}
                />
                <Tooltip />
                <Bar dataKey="sales_count" fill="#3b82f6" name="Verkäufe" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function FunnelDisplay({ funnel }: { funnel: { offers: number; accepted: number; paid: number; fulfilled: number } }) {
  const stages = [
    { label: 'Angebote', value: funnel.offers, color: 'bg-slate-400' },
    { label: 'Akzeptiert', value: funnel.accepted, color: 'bg-brand-500' },
    { label: 'Bezahlt', value: funnel.paid, color: 'bg-green-500' },
    { label: 'Erfüllt', value: funnel.fulfilled, color: 'bg-emerald-600' },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="space-y-3">
      {stages.map((s, idx) => {
        const pct = (s.value / max) * 100;
        const previousStage = idx > 0 ? stages[idx - 1] : undefined;
        const prev = previousStage?.value ?? s.value;
        const rate = prev > 0 ? (s.value / prev) * 100 : 0;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-700">{s.label}</span>
              <span className="text-slate-500">
                <span className="font-semibold text-slate-900">{s.value}</span>
                {previousStage && <span className="ml-2 text-xs">({rate.toFixed(0)}% von {previousStage.label})</span>}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${s.color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: JSX.Element; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-50 text-brand-700">
          {icon}
        </div>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}
