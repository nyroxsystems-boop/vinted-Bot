// ──────────────────────────────────────────────────────────────────────────────
// CashTracker — the most important widget on Home.
//
// Pulls /home/profit and renders three big-number panels (today, 7d, 30d) plus
// a glowy "live" indicator and a delta vs. yesterday. Designed to be the first
// thing a user sees: "How much money did this make today?"
//
// Falls back gracefully if the endpoint is missing (older orchestrator builds
// or empty DB) — renders a placeholder telling the user where data will appear.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, Activity, Clock } from 'lucide-react';
import { api } from '../api/client';
import { CountUp } from './CountUp';
import { fmtEur, fmtEurCompact, fmtRelative } from '../lib/format';

interface ProfitResp {
  ok: boolean;
  today: { revenue_eur: number; profit_eur: number; sales: number };
  yesterday: { revenue_eur: number; profit_eur: number; sales: number };
  last_7d: { revenue_eur: number; profit_eur: number; sales: number };
  last_30d: { revenue_eur: number; profit_eur: number; sales: number };
  last_sale_at: string | null;
}

const ZERO: ProfitResp['today'] = { revenue_eur: 0, profit_eur: 0, sales: 0 };

export function CashTracker({ query }: { query: string }) {
  const [data, setData] = useState<ProfitResp | null>(null);
  const [missing, setMissing] = useState(false);

  const fetchProfit = useCallback(async () => {
    try {
      const r = await api.get<ProfitResp>(`/home/profit${query}`);
      setData(r);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [query]);

  useEffect(() => {
    void fetchProfit();
    const t = setInterval(() => void fetchProfit(), 15_000);
    return () => clearInterval(t);
  }, [fetchProfit]);

  const today = data?.today ?? ZERO;
  const yesterday = data?.yesterday ?? ZERO;
  const last7 = data?.last_7d ?? ZERO;
  const last30 = data?.last_30d ?? ZERO;

  const todayDelta = today.profit_eur - yesterday.profit_eur;
  const todayDeltaPct =
    yesterday.profit_eur > 0
      ? ((today.profit_eur - yesterday.profit_eur) / yesterday.profit_eur) * 100
      : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/[0.04] via-zinc-900/60 to-rose-500/[0.04] p-6 shadow-2xl shadow-black/30">
      {/* glowy backdrop */}
      <div className="pointer-events-none absolute -top-12 right-0 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-0 h-72 w-72 rounded-full bg-rose-500/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-rose-500/15 ring-1 ring-rose-500/30">
            <Wallet size={17} className="text-rose-300" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-300/80">
              Cash Tracker
            </div>
            <h2 className="text-lg font-bold text-zinc-100">Live-Umsatz &amp; Profit</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="dot-good dot-pulse" />
          <span>Auto-Refresh alle 15 s</span>
          {data?.last_sale_at && (
            <>
              <span className="text-zinc-700">·</span>
              <Clock size={12} />
              <span>Letzter Sale {fmtRelative(data.last_sale_at)}</span>
            </>
          )}
        </div>
      </div>

      {missing && (
        <div className="relative mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          Profit-Endpoint nicht verfügbar — sobald Verkäufe einlaufen, erscheinen
          hier deine Cash-Zahlen. (Orchestrator-Endpoint <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs">/home/profit</code> erforderlich.)
        </div>
      )}

      <div className="relative mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Today — hero */}
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
              Heute · Profit
            </div>
            <Activity size={13} className="text-rose-400" />
          </div>
          <div className="mt-2">
            <CountUp
              value={today.profit_eur}
              format={fmtEur}
              className="display tabular text-[2.75rem] leading-none text-rose-100"
              duration={900}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <span className="text-zinc-400">
              {today.sales} Sale{today.sales === 1 ? '' : 's'} · Umsatz{' '}
              <span className="font-semibold text-zinc-200">{fmtEurCompact(today.revenue_eur)}</span>
            </span>
            {todayDelta !== 0 && (
              <span
                className={`inline-flex items-center gap-1 font-semibold ${
                  todayDelta > 0 ? 'text-rose-300' : 'text-rose-300'
                }`}
              >
                {todayDelta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {todayDelta > 0 ? '+' : ''}
                {fmtEurCompact(todayDelta)}
                {todayDeltaPct != null && (
                  <span className="text-zinc-500">({todayDeltaPct.toFixed(0)}%)</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Last 7 days */}
        <Tile label="Letzte 7 Tage" value={last7.profit_eur} sub={`${last7.sales} Sales · ${fmtEurCompact(last7.revenue_eur)} Umsatz`} />
        {/* Last 30 days */}
        <Tile label="Letzte 30 Tage" value={last30.profit_eur} sub={`${last30.sales} Sales · ${fmtEurCompact(last30.revenue_eur)} Umsatz`} />
      </div>
    </div>
  );
}

function Tile({
  label, value, sub, highlight,
}: { label: string; value: number; sub: string; highlight?: boolean }) {
  void highlight;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-2">
        <CountUp
          value={value}
          format={fmtEur}
          className="display tabular text-[2rem] leading-none text-zinc-100"
        />
      </div>
      <div className="mt-1.5 text-xs text-zinc-400">{sub}</div>
    </div>
  );
}
