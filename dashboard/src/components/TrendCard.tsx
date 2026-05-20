// ──────────────────────────────────────────────────────────────────────────────
// Vinted Trend Card
//
// Shows one scraped trend (brand / search / hashtag) with what we know about
// it: how popular it is on Vinted right now, what we mapped it to on CJ, and
// whether we've already imported products off it. Two actions per card:
//
//   • Open source — jump to the Vinted URL the trend came from
//   • Mark unused — clear last_used_at so CJ-Discovery re-fires the keyword
// ──────────────────────────────────────────────────────────────────────────────

import { ExternalLink, Sparkles, Tag, Hash, Search, RefreshCw } from 'lucide-react';
import { fmtRelative } from '../lib/format';

export interface Trend {
  id?: number;
  trend_type: 'search' | 'brand' | 'category' | 'hashtag';
  keyword: string;
  rank?: number;
  popularity?: number;
  cj_query?: string;
  source_url?: string;
  last_used_at?: string | null;
  imported_count?: number;
  category_path?: string;
}

interface Props {
  trend: Trend;
  onMarkUnused?: (id: number) => void;
  marking?: boolean;
}

function trendTypeBadge(t: Trend['trend_type']) {
  switch (t) {
    case 'brand':    return { label: 'brand',    icon: Sparkles, color: 'text-rose-300 border-rose-500/30 bg-rose-500/10' };
    case 'hashtag':  return { label: 'hashtag',  icon: Hash,     color: 'text-violet-300 border-violet-500/30 bg-violet-500/10' };
    case 'search':   return { label: 'search',   icon: Search,   color: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10' };
    case 'category': return { label: 'category', icon: Tag,      color: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10' };
  }
}

export function TrendCard({ trend, onMarkUnused, marking = false }: Props) {
  const badge = trendTypeBadge(trend.trend_type);
  const isUnused = !trend.last_used_at;
  const imported = trend.imported_count ?? 0;

  return (
    <div className="card-gradient relative flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {trend.rank != null && (
            <span className="inline-flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold tabular text-zinc-300">
              #{trend.rank}
            </span>
          )}
          <span className="display truncate text-[15px] font-semibold text-zinc-100">
            {trend.keyword}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>
          <badge.icon size={10} />
          {badge.label}
        </span>
      </div>

      {trend.cj_query && (
        <div className="text-[12px] text-zinc-400">
          <span className="text-zinc-600">→</span>{' '}
          <span className="font-mono text-zinc-300">&quot;{trend.cj_query}&quot;</span>
        </div>
      )}

      {trend.category_path && (
        <div className="text-[11px] text-zinc-500">
          {trend.category_path}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="tabular">{imported} imported</span>
        <span className="text-zinc-700">·</span>
        <span>
          {isUnused ? (
            <span className="text-emerald-400">nicht genutzt</span>
          ) : (
            <>last {fmtRelative(trend.last_used_at!)}</>
          )}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        {trend.source_url ? (
          <a
            href={trend.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-300"
          >
            <ExternalLink size={10} />
            <span className="truncate max-w-[180px]">
              {trend.source_url.replace(/^https?:\/\//, '')}
            </span>
          </a>
        ) : (
          <span />
        )}
        {trend.id != null && onMarkUnused && !isUnused && (
          <button
            type="button"
            disabled={marking}
            onClick={() => onMarkUnused(trend.id!)}
            className="btn-ghost text-[10px]"
            title="Setzt last_used_at zurück, damit CJ-Discovery den Trend wieder testet."
          >
            <RefreshCw size={10} /> Mark unused
          </button>
        )}
      </div>
    </div>
  );
}
