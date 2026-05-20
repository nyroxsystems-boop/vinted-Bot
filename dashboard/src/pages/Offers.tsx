import { useState } from 'react';
import { HandCoins, Check, X, Inbox } from 'lucide-react';
import { useOffers } from '../hooks/useOffers';
import { useListings } from '../hooks/useListings';
import { fmtEur, fmtRelative } from '../lib/format';
import { toast } from '../components/Toast';

export function OffersPage() {
  const { offers, loading, accept, decline, linkListing } = useOffers('pending');
  const { listings } = useListings();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function doAccept(id: number, amount: number) {
    setBusyId(id);
    try {
      await accept(id);
      toast.success(`Angebot ${fmtEur(amount)} angenommen`);
    } catch (e) {
      toast.error('Akzeptieren fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function doDecline(id: number) {
    setBusyId(id);
    try {
      await decline(id);
      toast.info('Angebot abgelehnt');
    } catch (e) {
      toast.error('Ablehnen fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
      </div>
    );
  }

  if (offers.length === 0) {
    return (
      <div className="card flex flex-col items-center py-12 text-center">
        <Inbox size={36} className="mb-3 text-zinc-600" strokeWidth={1.5} />
        <div className="text-base font-semibold text-zinc-200">Keine offenen Angebote</div>
        <div className="mt-1 max-w-sm text-sm text-zinc-500">
          Sobald Käufer ein Angebot machen, kannst du es hier in einem Klick annehmen oder ablehnen.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {offers.map((o) => {
        const listing = o.listing_id ? listings.find((l) => l.id === o.listing_id) : null;
        const minAccept = listing?.min_accept_price_eur ?? 0;
        const belowMin = listing && o.amount_eur < minAccept;
        return (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-300">
                <HandCoins size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular text-zinc-100">{fmtEur(o.amount_eur)}</span>
                  {belowMin && <span className="badge-warn">unter Min-Accept {fmtEur(minAccept)}</span>}
                  {!belowMin && listing && <span className="badge-good">≥ Min-Accept</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">
                  {listing ? listing.title : 'Listing wird verknüpft…'} · {fmtRelative(o.created_at)}
                </div>
              </div>
            </div>
            {!o.listing_id && (
              <select
                className="input max-w-xs"
                defaultValue=""
                onChange={async (e) => {
                  const id = Number.parseInt(e.target.value, 10);
                  if (!id) return;
                  setBusyId(o.id);
                  await linkListing(o.id, id);
                  setBusyId(null);
                }}
              >
                <option value="">— Listing verknüpfen —</option>
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} (min {fmtEur(l.min_accept_price_eur)})
                  </option>
                ))}
              </select>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-success"
                disabled={busyId === o.id}
                onClick={() => void doAccept(o.id, o.amount_eur)}
              >
                <Check size={14} /> Annehmen
              </button>
              <button
                className="btn-ghost"
                disabled={busyId === o.id}
                onClick={() => void doDecline(o.id)}
              >
                <X size={14} /> Ablehnen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
