import { useState } from 'react';
import { useOffers } from '../hooks/useOffers';
import { useListings } from '../hooks/useListings';

export function OffersPage() {
  const { offers, loading, accept, decline, linkListing } = useOffers('pending');
  const { listings } = useListings();
  const [busyId, setBusyId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Review-Queue · Offene Angebote</h1>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2">Erhalten</th>
              <th>Betrag</th>
              <th>Listing</th>
              <th className="text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  Lade…
                </td>
              </tr>
            )}
            {!loading && offers.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  Keine offenen Angebote.
                </td>
              </tr>
            )}
            {offers.map((o) => (
              <tr key={o.id} className="border-b last:border-0 align-top">
                <td className="py-2 text-xs text-slate-500">{o.created_at}</td>
                <td className="font-semibold">€{o.amount_eur.toFixed(2)}</td>
                <td>
                  {o.listing_id ? (
                    listings.find((l) => l.id === o.listing_id)?.title ?? `#${o.listing_id}`
                  ) : (
                    <select
                      className="input"
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
                          {l.title} (min €{l.min_accept_price_eur.toFixed(2)})
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="space-x-2 text-right">
                  <button
                    className="btn-primary"
                    disabled={busyId === o.id}
                    onClick={async () => {
                      setBusyId(o.id);
                      try {
                        await accept(o.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Akzeptieren
                  </button>
                  <button
                    className="btn-danger"
                    disabled={busyId === o.id}
                    onClick={async () => {
                      setBusyId(o.id);
                      try {
                        await decline(o.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Ablehnen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
