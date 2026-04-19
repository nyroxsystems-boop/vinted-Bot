import { useState } from 'react';
import type { TemuBatch } from '@vinted-system/shared';
import {
  useQueue,
  useBatches,
  createBatch,
  addBatchToCart,
  markBatchPlaced,
  loadBatch,
  type BatchItem,
} from '../hooks/useFulfillment';
import { ExternalLink, Package, PlayCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

const WINDOW_OPTIONS = [
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
  { hours: 72, label: '3 Tage' },
  { hours: 168, label: '7 Tage' },
];

const TEMU_CART_URL = 'https://www.temu.com/cart.html';

export function FulfillmentPage() {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const { items, loading, reload: reloadQueue } = useQueue(hours);
  const { batches, reload: reloadBatches } = useBatches();

  const totalListPrice = items.reduce((s, i) => s + i.list_price_eur, 0);

  const handleCreateBatch = async () => {
    setBusy(true);
    setLastResult(null);
    try {
      const r = await createBatch(hours);
      setLastResult(`✓ Batch #${r.batchId} erstellt mit ${r.saleCount} Artikeln.`);
      await Promise.all([reloadQueue(), reloadBatches()]);
    } catch (e) {
      setLastResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fulfillment</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sammelt verkaufte Artikel über ein Zeitfenster und legt sie per Klick in den Temu-Warenkorb.
          Du bezahlst dann einmalig auf Temu.
        </p>
      </div>

      {/* ── Window picker + queue ─────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Nächster Batch</h2>
            <p className="text-xs text-slate-500">Verkauft in den letzten:</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {WINDOW_OPTIONS.map((o) => (
              <button
                key={o.hours}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  hours === o.hours
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                onClick={() => setHours(o.hours)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex gap-4 text-sm">
          <span>
            <span className="font-semibold">{items.length}</span>{' '}
            <span className="text-slate-500">Artikel bereit</span>
          </span>
          <span>
            <span className="font-semibold">€{totalListPrice.toFixed(2)}</span>{' '}
            <span className="text-slate-500">Listpreis-Summe</span>
          </span>
        </div>

        {loading && <div className="text-sm text-slate-400">Lade…</div>}
        {!loading && items.length === 0 && (
          <div className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">
            Keine bezahlten Verkäufe in diesem Fenster.
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2">Listing</th>
                  <th>Käufer</th>
                  <th>Bezahlt</th>
                  <th>Temu-URL</th>
                  <th>Größe</th>
                  <th>Listpreis</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const variant = i.temu_variant ? (JSON.parse(i.temu_variant) as { size?: string }) : null;
                  return (
                    <tr key={i.sale_id} className="border-b last:border-0">
                      <td className="py-2 max-w-[240px] truncate">{i.listing_title}</td>
                      <td>{i.buyer_name}</td>
                      <td className="text-xs text-slate-500">{i.paid_at}</td>
                      <td>
                        <a
                          href={i.temu_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                        >
                          öffnen <ExternalLink size={12} />
                        </a>
                      </td>
                      <td className="font-mono text-xs">{variant?.size ?? '—'}</td>
                      <td>€{i.list_price_eur.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {lastResult && <div className="text-sm text-slate-600">{lastResult}</div>}
          <button
            className="btn-primary"
            disabled={busy || items.length === 0}
            onClick={handleCreateBatch}
          >
            <Package size={14} />
            Batch erstellen ({items.length} Artikel)
          </button>
        </div>
      </div>

      {/* ── Open / recent batches ────────────────────────────────────────── */}
      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Letzte Batches</h2>
        {batches.length === 0 ? (
          <div className="text-sm text-slate-400">Noch keine Batches.</div>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <BatchRow key={b.id} batch={b} onChanged={reloadBatches} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BatchRow({ batch, onChanged }: { batch: TemuBatch; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<BatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusBadge = STATUS_BADGES[batch.status] ?? STATUS_BADGES.open!;

  const toggle = async () => {
    setExpanded((v) => !v);
    if (!items) {
      const r = await loadBatch(batch.id);
      setItems(r.items);
    }
  };

  const handleAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await addBatchToCart(batch.id);
      if (!r.ok && r.failed > 0 && r.added === 0) {
        setError(`Alle ${r.failed} Items fehlgeschlagen.`);
      }
      await onChanged();
      // Refresh expanded items.
      const d = await loadBatch(batch.id);
      setItems(d.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPlaced = async () => {
    const temuOrderId = window.prompt('Temu-Bestellnummer (optional):') ?? undefined;
    setBusy(true);
    try {
      await markBatchPlaced(batch.id, temuOrderId || undefined);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white ${statusBadge.circleCls}`}
          >
            {statusBadge.icon}
          </div>
          <div>
            <div className="font-semibold">Batch #{batch.id}</div>
            <div className="text-xs text-slate-500">
              {batch.sale_count} Artikel · Fenster {batch.window_hours}h · erstellt {batch.created_at}
              {batch.total_eur ? ` · €${batch.total_eur.toFixed(2)}` : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>

          {batch.status === 'open' && (
            <button className="btn-primary" disabled={busy} onClick={handleAdd}>
              <PlayCircle size={14} />
              In Warenkorb legen
            </button>
          )}
          {batch.status === 'cart_ready' && (
            <>
              <a
                className="btn-primary"
                href={TEMU_CART_URL}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} />
                Zu Temu-Warenkorb
              </a>
              <button className="btn-secondary" disabled={busy} onClick={handleMarkPlaced}>
                <CheckCircle2 size={14} />
                Als bezahlt markieren
              </button>
            </>
          )}
          {batch.status === 'failed' && (
            <button className="btn-secondary" disabled={busy} onClick={handleAdd}>
              Erneut versuchen
            </button>
          )}
          <button className="btn-secondary" onClick={toggle}>
            {expanded ? 'Schließen' : 'Details'}
          </button>
        </div>
      </div>

      {batch.last_error && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle size={12} />
          {batch.last_error}
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

      {expanded && items && (
        <div className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-1">Listing</th>
                <th>Käufer</th>
                <th>Zustand</th>
                <th>Fehler</th>
                <th>€</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.temu_order_id_pk} className="border-b last:border-0">
                  <td className="py-1 max-w-[220px] truncate">{i.listing_title}</td>
                  <td>{i.buyer_name}</td>
                  <td>{i.state}</td>
                  <td className="max-w-[200px] truncate text-red-600" title={i.last_error ?? undefined}>
                    {i.last_error ?? ''}
                  </td>
                  <td>€{i.list_price_eur.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STATUS_BADGES: Record<string, { label: string; cls: string; circleCls: string; icon: JSX.Element }> = {
  open: {
    label: 'offen',
    cls: 'bg-slate-100 text-slate-700',
    circleCls: 'bg-slate-400',
    icon: <Package size={14} />,
  },
  adding: {
    label: 'in Bearbeitung',
    cls: 'bg-amber-100 text-amber-700',
    circleCls: 'bg-amber-500',
    icon: <PlayCircle size={14} />,
  },
  cart_ready: {
    label: 'Warenkorb bereit',
    cls: 'bg-brand-100 text-brand-700',
    circleCls: 'bg-brand-500',
    icon: <ExternalLink size={14} />,
  },
  placed: {
    label: 'bezahlt',
    cls: 'bg-green-100 text-green-700',
    circleCls: 'bg-green-500',
    icon: <CheckCircle2 size={14} />,
  },
  failed: {
    label: 'fehlgeschlagen',
    cls: 'bg-red-100 text-red-700',
    circleCls: 'bg-red-500',
    icon: <AlertTriangle size={14} />,
  },
};
