import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../api/client';
import { fmtEur } from '../lib/format';

interface TrendDay {
  date: string;
  listings: number;
  sales: number;
  revenue: number;
  profit: number;
}

interface TrendsResponse {
  ok: boolean;
  days: TrendDay[];
}

function shortLabel(iso: string): string {
  // 2026-05-13 → 13.05
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function HomeTrendsChart({ days = 14 }: { days?: number }) {
  const [data, setData] = useState<TrendDay[] | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<TrendsResponse>(`/home/trends?days=${days}`);
      setData(r.days);
      setMissing(false);
    } catch {
      // Endpoint may not be live yet (orchestrator not restarted) — fail
      // quietly so the rest of the page still renders.
      setMissing(true);
    }
  }, [days]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (missing) {
    return (
      <div className="card flex items-center justify-between text-sm text-zinc-500">
        <span>Trend-Daten verfügbar nach dem nächsten Orchestrator-Neustart.</span>
      </div>
    );
  }

  if (!data) {
    return <div className="skeleton h-44 rounded-xl" />;
  }

  const totalRevenue = data.reduce((a, b) => a + b.revenue, 0);
  const totalListings = data.reduce((a, b) => a + b.listings, 0);
  const totalSales = data.reduce((a, b) => a + b.sales, 0);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="h-section">Aktivität · letzte {days} Tage</div>
          <div className="mt-1 flex items-baseline gap-5 text-sm">
            <span className="text-zinc-300">
              <span className="kpi-value text-lg text-zinc-100">{totalListings}</span>
              <span className="ml-1.5 text-xs text-zinc-500">Listings</span>
            </span>
            <span className="text-zinc-300">
              <span className="kpi-value text-lg text-rose-300">{totalSales}</span>
              <span className="ml-1.5 text-xs text-zinc-500">Sales</span>
            </span>
            <span className="text-zinc-300">
              <span className="kpi-value text-lg text-zinc-100">{fmtEur(totalRevenue)}</span>
              <span className="ml-1.5 text-xs text-zinc-500">Umsatz</span>
            </span>
          </div>
        </div>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
            <defs>
              <linearGradient id="rubyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#f43f5e" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="violetFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#a855f7" stopOpacity={0.30} />
                <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortLabel}
              stroke="#52525b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#52525b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: '#0a0a0c',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: '#a1a1aa' }}
              formatter={(value: number, name: string) => {
                if (name === 'revenue') return [fmtEur(value), 'Umsatz'];
                if (name === 'sales')   return [value, 'Sales'];
                if (name === 'listings') return [value, 'Listings'];
                return [value, name];
              }}
              labelFormatter={shortLabel}
            />
            <Area
              type="monotone"
              dataKey="listings"
              stroke="#a855f7"
              strokeWidth={1.5}
              fill="url(#violetFill)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="#f43f5e"
              strokeWidth={2}
              fill="url(#rubyFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
