// ──────────────────────────────────────────────────────────────────────────────
// Auto-Pipeline Page
//
// Zentrale Übersicht über die vollautomatische Listing-Pipeline:
//
//   CJ-Discovery → Crawled (Source-Bilder geladen) → Image-Gen (Lifestyle-Shots)
//     → Variant-Gen (LLM-Texte pro Marketplace) → Auto-Publisher → Live
//
// Zeigt für jede Stufe den Counter, den letzten Run, eventuelle Errors.
// Manual-Triggers: "Discovery jetzt", "Image-Gen jetzt", "Auto-Publisher jetzt".
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, ImageIcon, PenSquare, Rocket, RefreshCw,
  Inbox, AlertTriangle, Activity, Package, ShoppingBag, Eye,
  Link as LinkIcon, Check, Search,
} from 'lucide-react';
import { api } from '../api/client';
import { fmtNum, fmtEur, fmtRelative } from '../lib/format';
import { CountUp } from '../components/CountUp';
import { toast } from '../components/Toast';

interface DiscoveryStats {
  counts: Record<string, number>;
  last_run: {
    id: number; raw_found: number; imported: number; skipped: number; errors: number;
    started_at: string; ended_at: string | null;
  } | null;
  last_import: { cj_product_id: string; title: string; score: number; updated_at: string } | null;
}

interface DiscoveryItem {
  id: number;
  cj_product_id: string;
  title: string | null;
  category_path: string | null;
  cost_eur: number | null;
  image_url: string | null;
  source_query: string | null;
  score: number;
  status: string;
  skip_reason: string | null;
  last_error: string | null;
  crawled_product_id: number | null;
  discovered_at: string;
}

interface ListingsCounts {
  by_status: Array<{ status: string; count: number }>;
}

type TabId = 'pipeline' | 'cj-mapping';

export function PipelinePage() {
  const [tab, setTab] = useState<TabId>('pipeline');
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [queue, setQueue] = useState<DiscoveryItem[]>([]);
  const [listingsCounts, setListingsCounts] = useState<ListingsCounts | null>(null);
  const [filter, setFilter] = useState<'all' | 'queued' | 'imported' | 'skipped' | 'failed'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, q, l] = await Promise.all([
        api.get<DiscoveryStats>('/discovery/stats'),
        api.get<{ items: DiscoveryItem[] }>(`/discovery/queue?limit=80${filter === 'all' ? '' : `&status=${filter}`}`),
        api.get<ListingsCounts>('/listings/stats').catch(() => ({ by_status: [] })),
      ]);
      setStats(s);
      setQueue(q.items);
      setListingsCounts(l);
    } catch (e) {
      console.error(e);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function runDiscovery() {
    setBusy('discovery');
    try {
      const r = await api.post<{ ok: boolean; imported?: number; errors?: number }>('/discovery/run-now');
      if (r.ok) toast.success(`Discovery fertig`, { detail: `Importiert: ${r.imported ?? 0} · Fehler: ${r.errors ?? 0}` });
      else toast.warn('Discovery läuft bereits');
      await load();
    } catch (e) {
      toast.error('Discovery fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  async function skipItem(id: number) {
    try {
      await api.post(`/discovery/queue/${id}/skip`);
      toast.info('Übersprungen');
      await load();
    } catch (e) { toast.error('Fehler', { detail: e instanceof Error ? e.message : String(e) }); }
  }

  async function requeueItem(id: number) {
    try {
      await api.post(`/discovery/queue/${id}/requeue`);
      toast.success('Zurück in die Queue');
      await load();
    } catch (e) { toast.error('Fehler', { detail: e instanceof Error ? e.message : String(e) }); }
  }

  const counts = stats?.counts ?? {};
  const lcStatus = (s: string) => listingsCounts?.by_status?.find((r) => r.status === s)?.count ?? 0;
  const cdraft = lcStatus('draft');
  const capproved = lcStatus('approved');
  const cpublished = lcStatus('published');
  const cfailed = lcStatus('failed');

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Auto-Pipeline</h1>
          <p className="page-subtitle">CJ-Discovery → Bild-Generation → LLM-Variants → Auto-Publisher — vollautomatisch.</p>
        </div>
        {tab === 'pipeline' && (
          <button onClick={() => void runDiscovery()} disabled={busy === 'discovery'} className="btn-primary">
            <Sparkles size={14} /> {busy === 'discovery' ? '…' : 'Discovery jetzt'}
          </button>
        )}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800">
        <TabButton id="pipeline"   active={tab} onClick={setTab} icon={Sparkles}>Pipeline</TabButton>
        <TabButton id="cj-mapping" active={tab} onClick={setTab} icon={LinkIcon}>CJ-Mapping</TabButton>
      </div>

      {tab === 'cj-mapping' && <CjMappingTab />}
      {tab === 'pipeline' && (
       <>
      {/* Pipeline-Stages */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StageCard
          icon={Inbox}
          label="1. Discovery"
          value={counts.queued ?? 0}
          sub={`${counts.imported ?? 0} importiert · ${counts.skipped ?? 0} skipped`}
          color="from-rose-500/15 to-rose-500/10"
          accent="text-rose-300"
        />
        <StageCard
          icon={ImageIcon}
          label="2. Bilder"
          value={cdraft}
          sub={`${counts.imported ?? 0} warten auf Image-Gen`}
          color="from-rose-500/15 to-rose-500/10"
          accent="text-rose-300"
        />
        <StageCard
          icon={PenSquare}
          label="3. Variants"
          value={capproved}
          sub={`${capproved} ready zum publishen`}
          color="from-rose-500/15 to-blue-500/10"
          accent="text-rose-300"
        />
        <StageCard
          icon={Rocket}
          label="4. Live"
          value={cpublished}
          sub={cfailed > 0 ? `${cfailed} failed` : 'alles grün'}
          color="from-rose-500/15 to-rose-500/10"
          accent="text-rose-300"
        />
      </div>

      {/* Last Run */}
      {stats?.last_run && (
        <div className="card-gradient flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="kpi-label">Letzter Discovery-Run</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="display text-2xl font-extrabold text-zinc-100">
                {stats.last_run.imported} importiert
              </span>
              <span className="text-xs text-zinc-500">
                aus {stats.last_run.raw_found} gefunden · {fmtRelative(stats.last_run.ended_at ?? stats.last_run.started_at)}
              </span>
            </div>
          </div>
          {stats.last_run.errors > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-300">
              <AlertTriangle size={13} /> {stats.last_run.errors} Errors
            </div>
          )}
          <button onClick={() => void load()} className="btn-ghost text-xs">
            <RefreshCw size={12} /> Aktualisieren
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'queued', 'imported', 'skipped', 'failed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={filter === s ? 'pill-on' : 'pill-off'}
          >
            {s === 'all' ? 'Alle' : s} {s !== 'all' && counts[s] != null && `(${counts[s]})`}
          </button>
        ))}
      </div>

      {/* Queue Table */}
      {queue.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <Inbox size={32} className="mb-3 text-zinc-600" strokeWidth={1.5} />
          <div className="text-base font-semibold text-zinc-200">Discovery-Queue ist leer</div>
          <div className="mt-1 max-w-sm text-sm text-zinc-500">
            Aktiviere die Auto-Discovery in den Einstellungen oder triggere einen Run manuell oben rechts.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Produkt</th>
                <th>Quelle</th>
                <th className="text-right">Preis</th>
                <th className="text-right">Score</th>
                <th>Status</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.image_url ? (
                      <img src={it.image_url} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded bg-zinc-800 text-zinc-600">
                        <ImageIcon size={14} />
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="line-clamp-1 max-w-md text-zinc-100">{it.title ?? '(kein Titel)'}</div>
                    <div className="text-[10px] text-zinc-500">{it.category_path ?? it.cj_product_id}</div>
                  </td>
                  <td className="text-xs text-zinc-400">{it.source_query ?? '—'}</td>
                  <td className="text-right tabular text-zinc-200">{it.cost_eur != null ? fmtEur(it.cost_eur) : '—'}</td>
                  <td className="text-right tabular">
                    <span className={it.score > 0.5 ? 'text-rose-300' : it.score > 0.3 ? 'text-amber-300' : 'text-zinc-500'}>
                      {it.score.toFixed(2)}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={it.status} skipReason={it.skip_reason} lastError={it.last_error} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {(it.status === 'skipped' || it.status === 'failed') && (
                        <button onClick={() => void requeueItem(it.id)} className="text-[11px] text-rose-300 hover:underline">
                          re-queue
                        </button>
                      )}
                      {it.status === 'queued' && (
                        <button onClick={() => void skipItem(it.id)} className="text-[11px] text-zinc-500 hover:text-zinc-300 hover:underline">
                          skip
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Last import */}
      {stats?.last_import && (
        <div className="card flex items-center gap-3 text-sm">
          <Eye size={15} className="text-rose-300" />
          <span>
            Zuletzt importiert: <span className="font-semibold text-zinc-100">{stats.last_import.title}</span>{' '}
            <span className="text-zinc-500">· Score {stats.last_import.score.toFixed(2)} · {fmtRelative(stats.last_import.updated_at)}</span>
          </span>
        </div>
      )}
       </>
      )}
    </div>
  );
}

function TabButton({
  id, active, onClick, icon: Icon, children,
}: {
  id: TabId;
  active: TabId;
  onClick: (id: TabId) => void;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
        isActive
          ? 'border-rose-500 text-rose-300'
          : 'border-transparent text-zinc-500 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {children}
    </button>
  );
}

interface CjMatchStatus {
  ok: boolean;
  counts: { total: number; matched: number; unmatched: number };
  recent_matched: Array<{ folder_num: number; title: string; cj_product_id: string; cj_variant_id: string; cost_eur: number; created_at: string }>;
  unmatched: Array<{ folder_num: number; title: string; status: string; created_at: string }>;
  tracking_states?: { awaiting: number; eu_ready: number; pushed: number; fallback: number };
  recent_tracking?: Array<{
    sale_id: number;
    cj_order_id: string;
    tracking_push_state: 'awaiting' | 'eu_ready' | 'pushed' | 'fallback';
    cn_logistic_name: string | null;
    cn_first_seen_at: string | null;
    eu_logistic_name: string | null;
    eu_handover_at: string | null;
    tracking_number: string | null;
    logistic_name: string | null;
    ordered_at: string | null;
  }>;
}

interface MatchResult {
  ok: boolean;
  scanned: number;
  matched: number;
  failed: number;
  details: Array<{
    folder_num: number;
    title: string;
    status: 'matched' | 'no_match' | 'error';
    cj_product_id?: string;
    cj_variant_id?: string;
    cost_eur?: number;
    error?: string;
  }>;
}

function CjMappingTab() {
  const [data, setData] = useState<CjMatchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<MatchResult | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<CjMatchStatus>('/cj/match-status');
      setData(r);
    } catch (e) {
      toast.error('Status laden fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function runAuto() {
    setBusy(true);
    setLastResult(null);
    try {
      const r = await api.post<MatchResult>('/cj/auto-match', { limit: 50 });
      setLastResult(r);
      toast.success(`${r.matched} verknüpft, ${r.failed} ohne Match`, {
        detail: `${r.scanned} Listings geprüft.`,
      });
      await load();
    } catch (e) {
      toast.error('Auto-Match fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function matchOne(folder_num: number) {
    setBusy(true);
    try {
      const r = await api.post<MatchResult>('/cj/auto-match', { folder_num });
      const detail = r.details?.[0];
      if (detail?.status === 'matched') {
        toast.success(`#${folder_num} verknüpft mit ${detail.cj_product_id}`, {
          detail: `Variant ${detail.cj_variant_id} · EK €${detail.cost_eur?.toFixed(2) ?? '?'}`,
        });
      } else {
        toast.warn(`#${folder_num} kein passender CJ-Match`, { detail: detail?.error ?? 'unknown' });
      }
      await load();
    } catch (e) {
      toast.error('Match fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="skeleton h-64 rounded-xl" />;

  const matchRate = data.counts.total > 0 ? (data.counts.matched / data.counts.total) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Counters + Action */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiBox label="Gesamt aktiv" value={data.counts.total} hint="ohne archived/sold" />
        <KpiBox label="Verknüpft" value={data.counts.matched} accent="ruby" hint={`${matchRate.toFixed(0)}% Rate`} />
        <KpiBox label="Offen" value={data.counts.unmatched} accent={data.counts.unmatched > 0 ? 'amber' : undefined} hint="brauchen CJ-Match" />
        <div className="card flex flex-col justify-between gap-2">
          <div>
            <div className="kpi-label">Auto-Match</div>
            <div className="text-[11px] text-zinc-500">Verbindet bis zu 50 Listings auf einmal</div>
          </div>
          <button
            onClick={() => void runAuto()}
            disabled={busy || data.counts.unmatched === 0}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <LinkIcon size={13} />}
            {busy ? 'Verbinde …' : data.counts.unmatched === 0 ? 'Alles verknüpft' : 'Jetzt verbinden'}
          </button>
        </div>
      </div>

      {/* Last run summary */}
      {lastResult && (
        <div className="card border-rose-500/30 bg-rose-500/[0.04]">
          <div className="kpi-label">Letzter Auto-Match-Lauf</div>
          <div className="mt-1 flex items-baseline gap-3 text-sm">
            <span className="text-rose-300 font-bold">{lastResult.matched} verknüpft</span>
            <span className="text-zinc-500">·</span>
            <span className="text-amber-300">{lastResult.failed} ohne Match</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-400">{lastResult.scanned} gescannt</span>
          </div>
          {lastResult.details.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {lastResult.details.slice(0, 5).map((d) => (
                <li key={d.folder_num} className="flex items-start gap-2">
                  {d.status === 'matched' ? (
                    <Check size={11} className="mt-0.5 shrink-0 text-rose-400" />
                  ) : (
                    <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" />
                  )}
                  <span className="text-zinc-400 tabular">#{d.folder_num}</span>
                  <span className="truncate text-zinc-200">{d.title}</span>
                  {d.error && <span className="ml-auto text-zinc-500">{d.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Unmatched listings */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-100">Noch nicht verknüpft ({data.unmatched.length})</h3>
          <span className="text-[11px] text-zinc-500">Auto-Match versucht es alle 30 min</span>
        </div>
        {data.unmatched.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Check size={14} className="text-rose-400" />
            Alle aktiven Listings haben einen CJ-Match. Sales gehen automatisch raus.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Titel</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.unmatched.slice(0, 15).map((u) => (
                  <tr key={u.folder_num}>
                    <td className="font-mono text-xs">#{u.folder_num}</td>
                    <td className="max-w-md truncate">{u.title}</td>
                    <td><span className="badge-muted">{u.status}</span></td>
                    <td className="text-zinc-500 text-xs">{fmtRelative(u.created_at)}</td>
                    <td>
                      <button
                        onClick={() => void matchOne(u.folder_num)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-xs text-rose-300 hover:underline"
                      >
                        <Search size={11} /> Mapping suchen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recently matched */}
      {data.recent_matched.length > 0 && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-zinc-100">Zuletzt verknüpft</h3>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Titel</th>
                  <th>CJ-Produkt</th>
                  <th className="text-right">EK</th>
                  <th>Verknüpft</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_matched.map((m) => (
                  <tr key={m.folder_num}>
                    <td className="font-mono text-xs">#{m.folder_num}</td>
                    <td className="max-w-md truncate">{m.title}</td>
                    <td className="font-mono text-[10px] text-zinc-400">
                      <a
                        href={`https://cjdropshipping.com/product/${m.cj_product_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-rose-300"
                      >
                        {m.cj_product_id}
                      </a>
                    </td>
                    <td className="text-right tabular">{fmtEur(m.cost_eur)}</td>
                    <td className="text-zinc-500 text-xs">{fmtRelative(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Smart-Tracking-Status — Order-stage view */}
      {data.tracking_states && (data.tracking_states.awaiting + data.tracking_states.eu_ready + data.tracking_states.pushed + data.tracking_states.fallback) > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-zinc-100">Tracking-Status (aktive Orders)</h3>
            <span className="text-[11px] text-zinc-500">Auto-Push nur wenn EU-Carrier · Fallback nach 9 Tagen</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TrackingPill label="Wartet auf Carrier" value={data.tracking_states.awaiting} tone="muted" />
            <TrackingPill label="EU-Übergabe ✓" value={data.tracking_states.eu_ready} tone="info" />
            <TrackingPill label="An Vinted gepuscht" value={data.tracking_states.pushed} tone="success" />
            <TrackingPill label="Fallback (CN)" value={data.tracking_states.fallback} tone="warn" />
          </div>

          {data.recent_tracking && data.recent_tracking.length > 0 && (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Status</th>
                    <th>CN-Carrier</th>
                    <th>EU-Carrier</th>
                    <th>Tracking</th>
                    <th>Order-Alter</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_tracking.map((t) => {
                    const ageDays = t.ordered_at
                      ? Math.floor((Date.now() - new Date(t.ordered_at).getTime()) / 86_400_000)
                      : null;
                    return (
                      <tr key={t.cj_order_id}>
                        <td className="font-mono text-xs">#{t.sale_id}</td>
                        <td>
                          <TrackingStatusPill state={t.tracking_push_state} />
                        </td>
                        <td className="text-zinc-400 text-xs">
                          {t.cn_logistic_name ? (
                            <span title={t.cn_first_seen_at ?? ''}>{t.cn_logistic_name}</span>
                          ) : '—'}
                        </td>
                        <td className="text-zinc-200 text-xs">
                          {t.eu_logistic_name ? (
                            <span className="font-semibold text-rose-300" title={t.eu_handover_at ?? ''}>
                              {t.eu_logistic_name}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="font-mono text-[10px] text-zinc-400 max-w-[200px] truncate">
                          {t.tracking_number ?? '—'}
                        </td>
                        <td className="text-zinc-500 text-xs">
                          {ageDays != null ? `${ageDays} Tag${ageDays === 1 ? '' : 'e'}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrackingPill({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: 'muted' | 'info' | 'success' | 'warn';
}) {
  const cls = {
    muted:   'border-zinc-800 bg-zinc-900/40 text-zinc-300',
    info:    'border-rose-500/30 bg-rose-500/[0.06] text-rose-200',
    success: 'border-rose-500/40 bg-rose-500/[0.10] text-rose-100',
    warn:    'border-amber-500/30 bg-amber-500/5 text-amber-200',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <div className="tabular text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function TrackingStatusPill({ state }: { state: 'awaiting' | 'eu_ready' | 'pushed' | 'fallback' }) {
  const cfg = {
    awaiting: { label: 'Wartet',  cls: 'bg-zinc-800 text-zinc-400 ring-zinc-700' },
    eu_ready: { label: 'EU-handover', cls: 'bg-rose-500/15 text-rose-200 ring-rose-500/30' },
    pushed:   { label: 'Gepuscht', cls: 'bg-rose-500/20 text-rose-100 ring-rose-500/40' },
    fallback: { label: 'Fallback CN', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/30' },
  }[state];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function KpiBox({ label, value, hint, accent }: { label: string; value: number; hint?: string; accent?: 'ruby' | 'amber' }) {
  const cls =
    accent === 'ruby'  ? 'text-rose-300'
    : accent === 'amber' ? 'text-amber-300'
    : 'text-zinc-100';
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={`mt-1 tabular text-2xl font-bold ${cls}`}>
        <CountUp value={value} format={(n) => fmtNum(Math.round(n))} />
      </div>
      {hint && <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

function StageCard({
  icon: Icon, label, value, sub, color, accent,
}: {
  icon: typeof Activity; label: string; value: number; sub: string; color: string; accent: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br ${color} p-5`}>
      <div className="flex items-center justify-between">
        <Icon size={16} className={accent} />
        <span className="kpi-label">{label}</span>
      </div>
      <div className="mt-3 display tabular text-3xl font-extrabold text-zinc-100">
        <CountUp value={value} format={(n) => fmtNum(Math.round(n))} />
      </div>
      <div className="mt-1 text-xs text-zinc-400">{sub}</div>
    </div>
  );
}

function StatusPill({ status, skipReason, lastError }: { status: string; skipReason: string | null; lastError: string | null }) {
  const map: Record<string, string> = {
    queued:    'badge-info',
    importing: 'badge-warn',
    imported:  'badge-good',
    skipped:   'badge-muted',
    failed:    'badge-bad',
  };
  const cls = map[status] ?? 'badge-muted';
  return (
    <span className={cls} title={skipReason ?? lastError ?? undefined}>
      {status}
    </span>
  );
}
