// ──────────────────────────────────────────────────────────────────────────────
// Trends Page
//
// What Vinted-buyers are looking at right now (brands, searches, hashtags),
// scraped from Vinted's own catalog pages. CJ-Discovery uses these as
// targeted sourcing input — instead of "popular on CJ" (supplier-side
// noise) we go after "demand signals from the buyers we sell to".
//
// Three tabs: Brand / Search / Hashtag. One "Scrape jetzt" trigger that
// kicks off the trend-worker on-demand. Per-card "Mark unused" forces
// CJ-Discovery to re-fire that keyword on the next tick.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { TrendCard, type Trend } from '../components/TrendCard';
import { toast } from '../components/Toast';

type TrendType = 'brand' | 'search' | 'hashtag';

interface TrendsResponse {
  ok: boolean;
  count: number;
  trends: Trend[];
}

interface ScrapeResponse {
  ok: boolean;
  inserted?: number;
  error?: string;
}

const TABS: Array<{ id: TrendType; label: string }> = [
  { id: 'brand',   label: 'Brand'   },
  { id: 'search',  label: 'Search'  },
  { id: 'hashtag', label: 'Hashtag' },
];

export function TrendsPage() {
  const [tab, setTab] = useState<TrendType>('brand');
  const [trends, setTrends] = useState<Trend[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<TrendsResponse>(`/trends?limit=50&type=${tab}`);
      setTrends(r.trends ?? []);
    } catch (e) {
      toast.error('Trends konnten nicht geladen werden', {
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function scrapeNow() {
    setScraping(true);
    try {
      const r = await api.post<ScrapeResponse>('/trends/scrape-now');
      if (r.ok) {
        toast.success('Scrape gestartet', {
          detail: r.inserted != null ? `${r.inserted} neue Trends` : undefined,
        });
        await load();
      } else {
        toast.warn('Scrape läuft bereits', { detail: r.error });
      }
    } catch (e) {
      toast.error('Scrape fehlgeschlagen', {
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setScraping(false);
    }
  }

  async function markUnused(id: number) {
    setMarkingId(id);
    try {
      await api.post(`/trends/${id}/mark-used`);
      toast.success('Trend zurückgesetzt');
      await load();
    } catch (e) {
      toast.error('Konnte nicht zurückgesetzt werden', {
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Trends</h1>
          <p className="page-subtitle">
            Brand / Search / Hashtag — was Vinted-Käufer:innen gerade suchen.
            CJ-Discovery zieht hieraus die Sourcing-Queries.
          </p>
        </div>
        <button
          onClick={() => void scrapeNow()}
          disabled={scraping}
          className="btn-primary"
        >
          <Sparkles size={14} /> {scraping ? '…' : 'Scrape jetzt'}
        </button>
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'px-4 py-2 text-[13px] font-semibold text-zinc-100 border-b-2 border-rose-400'
                : 'px-4 py-2 text-[13px] font-medium text-zinc-500 hover:text-zinc-300'
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp size={12} />
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {loading && trends.length === 0 ? (
        <div className="card flex items-center justify-center py-12 text-sm text-zinc-500">
          Lade Trends…
        </div>
      ) : trends.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <TrendingUp size={28} className="text-zinc-600" />
          <div className="text-sm text-zinc-400">Noch keine {tab}-Trends geladen.</div>
          <button onClick={() => void scrapeNow()} className="btn-primary" disabled={scraping}>
            <RefreshCw size={12} /> Jetzt scrapen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trends.map((t, i) => (
            <TrendCard
              key={t.id ?? `${t.trend_type}-${t.keyword}-${i}`}
              trend={t}
              onMarkUnused={markUnused}
              marking={markingId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
