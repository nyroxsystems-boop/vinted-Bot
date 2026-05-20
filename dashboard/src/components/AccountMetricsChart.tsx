// ──────────────────────────────────────────────────────────────────────────────
// AccountMetricsCard — renders per-account daily KPIs in Accounts.tsx.
//
// Data: GET /api/accounts/:id/metrics?days=7 → { latest, range, days }.
// The orchestrator's account-metrics-collector populates the underlying
// `account_metrics` table once per 24h.
//
// Layout: a compact grid of stat tiles + a warnings row that highlights any
// strings the bot collected (captcha hit, rate-limit, not-authenticated, …).
// If the API returns no rows yet (fresh install, no scrapes done) we render
// an "Noch keine Daten" empty-state instead of NaN spew.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Heart,
  Loader2,
  MessageSquare,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../api/client';
import { fmtEur, fmtNum } from '../lib/format';

interface AccountMetric {
  account_id: number;
  date: string;
  followers: number | null;
  following: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  wallet_eur: number | null;
  verified: boolean;
  warnings: string[];
  views_today: number;
  likes_today: number;
  messages_today: number;
  sales_today: number;
  revenue_today_eur: number;
}

interface MetricsResponse {
  latest: AccountMetric | null;
  range: AccountMetric[];
  days: number;
}

/**
 * Returns the follower delta between the most recent snapshot and the oldest
 * one within `range`. Null when either side is missing — the caller renders
 * "—" instead of a misleading "+0".
 */
function followerDelta(range: AccountMetric[]): number | null {
  if (range.length < 2) return null;
  const latest = range[0]?.followers;
  const oldest = range[range.length - 1]?.followers;
  if (latest == null || oldest == null) return null;
  return latest - oldest;
}

function formatDelta(d: number | null): string {
  if (d == null) return '';
  if (d === 0) return '±0';
  return d > 0 ? `+${fmtNum(d)}` : fmtNum(d);
}

interface Props {
  accountId: number;
}

export function AccountMetricsCard({ accountId }: Props) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get<MetricsResponse>(`/accounts/${accountId}/metrics?days=7`);
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-zinc-500">
        <Loader2 size={12} className="animate-spin" />
        Lade Account-Metriken…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-amber-400">
        Account-Metriken konnten nicht geladen werden: {error}
      </div>
    );
  }

  const latest = data?.latest ?? null;
  const range = data?.range ?? [];
  const delta = followerDelta(range);

  if (!latest) {
    return (
      <div className="px-4 py-3 text-xs italic text-zinc-500">
        Noch keine Account-Metriken — der Collector schreibt täglich einen Snapshot.
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800/80 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <TrendingUp size={11} /> Account-Metriken
        </div>
        <div className="text-[10px] text-zinc-500">
          Snapshot vom {latest.date}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Followers */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Users size={11} /> Follower
          </div>
          <div className="mt-0.5 text-sm font-semibold text-zinc-100">
            {latest.followers != null ? fmtNum(latest.followers) : '—'}
          </div>
          {delta != null && delta !== 0 && (
            <div
              className={`text-[10px] ${
                delta > 0 ? 'text-rose-400' : 'text-amber-400'
              }`}
            >
              {formatDelta(delta)} in 7 Tagen
            </div>
          )}
        </div>

        {/* Rating */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Star size={11} /> Rating
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-zinc-100">
            {latest.rating_avg != null
              ? `${latest.rating_avg.toFixed(1)}`
              : '—'}
            {latest.verified && (
              <CheckCircle2 size={12} className="text-rose-400" />
            )}
          </div>
          <div className="text-[10px] text-zinc-500">
            {latest.rating_count != null
              ? `${fmtNum(latest.rating_count)} Bewertungen`
              : 'keine Bewertungen'}
          </div>
        </div>

        {/* Wallet */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Wallet size={11} /> Wallet
          </div>
          <div className="mt-0.5 text-sm font-semibold text-zinc-100">
            {latest.wallet_eur != null ? fmtEur(latest.wallet_eur) : '—'}
          </div>
        </div>

        {/* Sales today */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Heart size={11} /> Heute
          </div>
          <div className="mt-0.5 text-sm font-semibold text-zinc-100">
            {fmtNum(latest.sales_today)} Sales
          </div>
          <div className="text-[10px] text-zinc-500">
            {fmtEur(latest.revenue_today_eur)} Umsatz
          </div>
        </div>
      </div>

      {/* Sub-row: views / likes / messages */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <TrendingUp size={10} /> {fmtNum(latest.views_today)} Views heute
        </span>
        <span className="inline-flex items-center gap-1">
          <Heart size={10} /> {fmtNum(latest.likes_today)} Likes
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={10} /> {fmtNum(latest.messages_today)} Nachrichten
        </span>
      </div>

      {/* Warnings */}
      {latest.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            <AlertTriangle size={10} /> Warnungen
          </span>
          {latest.warnings.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
              title={w}
            >
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
