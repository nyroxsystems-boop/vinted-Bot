// Purchase queue — paid sales waiting for a manual Temu/CJ purchase.
// One-click opens the source URL. After buying, user clicks "Gekauft".

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, ShoppingBag, Check, Inbox } from 'lucide-react';
import { apiUrl } from '../api/base';
import { toast } from '../components/Toast';
import { fmtEur } from '../lib/format';

interface QueueItem {
  saleId: number;
  paidAt: string | null;
  buyer: string;
  buyerAddress: { street?: string; zip?: string; city?: string } | null;
  listingId: number;
  title: string;
  temuUrl: string | null;
  listPriceEur: number;
  state: string;
}

export function PurchaseQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const res = await fetch(apiUrl('/api/purchase-queue'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: QueueItem[] };
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);

  const markPurchased = async (saleId: number): Promise<void> => {
    setBusy(saleId);
    try {
      const temuOrderId = prompt('Temu-Bestellnummer (optional):') ?? undefined;
      const res = await fetch(apiUrl(`/api/purchase-queue/${saleId}/mark-purchased`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temuOrderId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Bestellung markiert');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Temu-Kauf</h1>
            <span className="badge-info">{items.length} offen</span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Verkaufte Artikel, die du jetzt auf Temu nachbestellen musst.
            Ein Klick → Temu-Seite öffnet sich.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
        </div>
      ) : error ? (
        <div className="card border-rose-500/30 bg-rose-500/5 text-sm text-rose-300">
          Fehler beim Laden: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <Inbox size={36} className="mb-3 text-zinc-600" strokeWidth={1.5} />
          <div className="text-base font-semibold text-zinc-200">
            Nichts zu kaufen — alle verkauften Artikel sind gedeckt
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            Neue Verkäufe erscheinen hier automatisch.
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <div
              key={item.saleId}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-rose-500/15 text-rose-300">
                    <ShoppingBag size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-100">
                      {item.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      <span>Sale #{item.saleId}</span>
                      <span>· {item.buyer}</span>
                      {item.buyerAddress?.city && (
                        <span>· {item.buyerAddress.zip} {item.buyerAddress.city}</span>
                      )}
                      <span>· VK <span className="font-semibold text-zinc-300">{fmtEur(item.listPriceEur)}</span></span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.temuUrl ? (
                  <a href={item.temuUrl} target="_blank" rel="noreferrer" className="btn-primary">
                    <ExternalLink size={13} /> Temu öffnen
                  </a>
                ) : (
                  <span className="text-xs italic text-zinc-500">Kein Temu-Link</span>
                )}
                <button
                  onClick={() => markPurchased(item.saleId)}
                  disabled={busy === item.saleId}
                  className="btn-secondary"
                >
                  {busy === item.saleId ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}{' '}
                  Gekauft
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
