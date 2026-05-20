// ──────────────────────────────────────────────────────────────────────────────
// Refunds page — dispute inbox + resolver UI.
//
// Lists all refund_disputes with a status-filter tabbar. Each card shows:
//   • Sale ID + marketplace badge + buyer-message snippet
//   • Reason chip + status chip + opened-at relative
//   • Action buttons: Resolve (with optional refund €) / Reject
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  PackageX,
  RefreshCw,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { fmtEur, fmtRelative } from '../lib/format';
import { toast } from '../components/Toast';
import { MarketplaceBadge } from '../components/MarketplaceBadge';

type RefundReason = 'not_arrived' | 'wrong_size' | 'damaged' | 'not_as_described' | 'other';
type RefundStatus = 'open' | 'awaiting_cj' | 'refunded_buyer' | 'closed' | 'rejected';

interface SaleContext {
  marketplace: string | null;
  buyer_name: string | null;
  paid_at: string | null;
  tracking_number: string | null;
  listing_title: string | null;
  listing_url: string | null;
  list_price_eur: number | null;
}

interface Dispute {
  id: number;
  sale_id: number;
  account_id: number | null;
  reason: RefundReason;
  status: RefundStatus;
  buyer_message: string | null;
  customer_evidence_url: string | null;
  refund_eur: number | null;
  cj_refund_id: string | null;
  resolution_note: string | null;
  opened_at: string;
  resolved_at: string | null;
  sale_context: SaleContext | null;
}

interface DisputesResponse {
  ok: boolean;
  disputes: Dispute[];
  count: number;
}

interface StatsResponse {
  ok: boolean;
  total: number;
  by_status: Record<string, number>;
}

const TABS: Array<{ id: RefundStatus | 'all'; label: string; icon: typeof Inbox; tint: string }> = [
  { id: 'open',           label: 'Offen',         icon: AlertCircle,  tint: 'text-rose-300' },
  { id: 'awaiting_cj',    label: 'Warte auf CJ',  icon: Clock,        tint: 'text-amber-300' },
  { id: 'refunded_buyer', label: 'Erstattet',     icon: CheckCircle2, tint: 'text-emerald-300' },
  { id: 'closed',         label: 'Geschlossen',   icon: ScrollText,   tint: 'text-zinc-400' },
  { id: 'rejected',       label: 'Abgelehnt',     icon: XCircle,      tint: 'text-zinc-500' },
  { id: 'all',            label: 'Alle',          icon: Inbox,        tint: 'text-zinc-300' },
];

const REASON_LABELS: Record<RefundReason, string> = {
  not_arrived:      'Nicht angekommen',
  wrong_size:       'Falsche Größe',
  damaged:          'Beschädigt',
  not_as_described: 'Nicht wie beschrieben',
  other:            'Sonstiges',
};

const STATUS_TINT: Record<RefundStatus, string> = {
  open:           'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  awaiting_cj:    'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  refunded_buyer: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  closed:         'bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/40',
  rejected:       'bg-zinc-700/40 text-zinc-500 ring-1 ring-zinc-700/40',
};

function ReasonChip({ reason }: { reason: RefundReason }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
      {REASON_LABELS[reason]}
    </span>
  );
}

function StatusChip({ status }: { status: RefundStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_TINT[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function DisputeCard({
  dispute,
  busy,
  onResolve,
  onReject,
}: {
  dispute: Dispute;
  busy: boolean;
  onResolve: (note: string, refundEur: number | undefined) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}) {
  const [resolverOpen, setResolverOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveAmount, setResolveAmount] = useState<string>('');
  const ctx = dispute.sale_context;
  const isTerminal = dispute.status === 'closed' || dispute.status === 'rejected' || dispute.status === 'refunded_buyer';

  return (
    <div className="card-hover space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-zinc-100">Sale #{dispute.sale_id}</span>
          {ctx?.marketplace && <MarketplaceBadge id={ctx.marketplace} size="sm" />}
          <ReasonChip reason={dispute.reason} />
          <StatusChip status={dispute.status} />
        </div>
        <div className="text-[11px] text-zinc-500">
          eröffnet {fmtRelative(dispute.opened_at)}
        </div>
      </div>

      {ctx && (
        <div className="text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">
            {ctx.listing_title ?? '— ohne Titel —'}
          </span>
          {ctx.list_price_eur ? <span className="ml-1">· {fmtEur(ctx.list_price_eur)}</span> : null}
          {ctx.buyer_name ? <span className="ml-1">· Käufer: {ctx.buyer_name}</span> : null}
        </div>
      )}

      {dispute.buyer_message && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm leading-snug text-zinc-200">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Käufer-Nachricht
          </span>
          <p className="mt-1 whitespace-pre-wrap break-words">{dispute.buyer_message}</p>
        </div>
      )}

      {dispute.resolution_note && (
        <div className="text-[11px] italic text-zinc-500">
          Notiz: {dispute.resolution_note}
        </div>
      )}

      {dispute.refund_eur !== null && dispute.refund_eur !== undefined && (
        <div className="text-xs text-emerald-300">
          Erstattet: {fmtEur(dispute.refund_eur)}
        </div>
      )}

      {!isTerminal && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!resolverOpen ? (
            <>
              <button
                className="btn-success text-xs"
                disabled={busy}
                onClick={() => setResolverOpen(true)}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Resolve
              </button>
              <button
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() => void onReject('Rejected from dashboard')}
              >
                <XCircle size={13} /> Reject
              </button>
            </>
          ) : (
            <div className="w-full space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
              <textarea
                placeholder='Resolution-Notiz (z. B. 1:1 Replacement, 50% Rabatt, …)'
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                rows={2}
                className="input w-full"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Refund € (optional)"
                  value={resolveAmount}
                  onChange={(e) => setResolveAmount(e.target.value)}
                  className="input max-w-[180px]"
                />
                <button
                  className="btn-success text-xs"
                  disabled={busy}
                  onClick={async () => {
                    const amt = resolveAmount.trim() === '' ? undefined : Number(resolveAmount);
                    await onResolve(resolveNote.trim() || 'Resolved from dashboard', amt);
                    setResolverOpen(false);
                    setResolveNote('');
                    setResolveAmount('');
                  }}
                >
                  Speichern
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setResolverOpen(false);
                    setResolveNote('');
                    setResolveAmount('');
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RefundsPage() {
  const [tab, setTab] = useState<RefundStatus | 'all'>('open');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const path = tab === 'all' ? '/refunds' : `/refunds?status=${tab}`;
      const [d, s] = await Promise.all([
        api.get<DisputesResponse>(path),
        api.get<StatsResponse>('/refunds/stats').catch(() => null),
      ]);
      setDisputes(d.disputes ?? []);
      if (s) setStats(s);
    } catch (err) {
      toast.error('Refunds laden fehlgeschlagen', { detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    void fetchData();
    const t = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  async function resolve(id: number, note: string, refundEur: number | undefined) {
    setBusyId(id);
    try {
      await api.post(`/refunds/${id}/resolve`, { resolution: note, refund_eur: refundEur });
      toast.success(refundEur ? `Erstattet: ${fmtEur(refundEur)}` : 'Refund-Case geschlossen');
      await fetchData();
    } catch (err) {
      toast.error('Resolve fehlgeschlagen', { detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: number, reason: string) {
    setBusyId(id);
    try {
      await api.post(`/refunds/${id}/reject`, { reason });
      toast.info('Refund-Case abgelehnt');
      await fetchData();
    } catch (err) {
      toast.error('Reject fehlgeschlagen', { detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => stats?.by_status ?? {}, [stats]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Refunds &amp; Disputes</h1>
          <p className="page-subtitle">Käufer-Reklamationen, Auto-Klassifizierung &amp; Resolver</p>
        </div>
        <button
          className="btn-ghost text-xs"
          onClick={() => void fetchData()}
        >
          <RefreshCw size={13} /> Aktualisieren
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Offen" value={counts.open ?? 0} tint="text-rose-300" />
          <StatCard label="Awaiting CJ" value={counts.awaiting_cj ?? 0} tint="text-amber-300" />
          <StatCard label="Erstattet" value={counts.refunded_buyer ?? 0} tint="text-emerald-300" />
          <StatCard label="Geschlossen" value={counts.closed ?? 0} tint="text-zinc-300" />
          <StatCard label="Abgelehnt" value={counts.rejected ?? 0} tint="text-zinc-400" />
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          const c = t.id === 'all' ? stats?.total ?? 0 : (counts[t.id] ?? 0);
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                isActive ? 'border-rose-500 text-rose-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <t.icon size={14} className={isActive ? t.tint : ''} />
              <span>{t.label}</span>
              {c > 0 && (
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 tabular">
                  {c}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-lg" />)}
        </div>
      ) : disputes.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <PackageX size={36} className="mb-3 text-zinc-600" strokeWidth={1.5} />
          <div className="text-base font-semibold text-zinc-200">Keine Disputes</div>
          <div className="mt-1 max-w-sm text-sm text-zinc-500">
            {tab === 'open'
              ? 'Klar — alles ruhig. Refund-Workflow scannt jede Stunde nach Reklamationen.'
              : 'Hier wird es leer bleiben.'}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {disputes.map((d) => (
            <DisputeCard
              key={d.id}
              dispute={d}
              busy={busyId === d.id}
              onResolve={(note, eur) => resolve(d.id, note, eur)}
              onReject={(reason) => reject(d.id, reason)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="card-hover">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value mt-1 ${tint}`}>{value}</div>
    </div>
  );
}
