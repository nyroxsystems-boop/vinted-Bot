import { useMemo } from 'react';
import { useOrders, type OrderRow } from '../hooks/useOrders';

type Action = 'none' | 'wait-temu' | 'temu-arrived' | 'mark-shipped' | 'manual-check' | 'fix-temu';

function computeAction(o: OrderRow): Action {
  if (o.shipped_at) return 'none';
  if (o.temu_state === 'failed' || (o.temu_last_error && !o.temu_order_id)) return 'fix-temu';
  if (!o.paid_at) return 'wait-temu';
  if (o.temu_state === 'placed') return 'wait-temu';
  if (o.temu_state === 'shipped') return 'wait-temu';
  if (o.temu_state === 'delivered') return 'temu-arrived';
  if (!o.temu_state) return 'manual-check';
  return 'none';
}

const ACTION_LABEL: Record<Action, { text: string; cls: string; hint: string }> = {
  none: {
    text: '✓ fertig',
    cls: 'bg-zinc-800 text-zinc-400',
    hint: 'Paket bereits an Käufer geschickt.',
  },
  'wait-temu': {
    text: 'Warten',
    cls: 'bg-zinc-800 text-zinc-300',
    hint: 'Paket von Temu ist unterwegs. Nichts zu tun.',
  },
  'temu-arrived': {
    text: '📦 JETZT HANDELN',
    cls: 'bg-amber-100 text-amber-900 font-bold',
    hint: 'Temu-Paket ist zugestellt. Vinted-Label drucken, aufkleben, abgeben.',
  },
  'mark-shipped': {
    text: 'Als versandt markieren',
    cls: 'bg-brand-100 text-brand-700',
    hint: 'Du hast das Paket abgegeben? Dann klick hier.',
  },
  'manual-check': {
    text: '? Status prüfen',
    cls: 'bg-zinc-800 text-zinc-300',
    hint: 'Unklar — im Temu-Konto manuell nachschauen.',
  },
  'fix-temu': {
    text: 'Temu-Fehler',
    cls: 'bg-red-100 text-red-700',
    hint: 'Temu-Bestellung ist fehlgeschlagen. Manuell bestellen oder Listing prüfen.',
  },
};

export function OrdersPage() {
  const { orders, loading, error, reload } = useOrders();

  const grouped = useMemo(() => {
    const g = { action: [] as OrderRow[], waiting: [] as OrderRow[], done: [] as OrderRow[] };
    for (const o of orders) {
      const a = computeAction(o);
      if (a === 'temu-arrived' || a === 'fix-temu' || a === 'manual-check') g.action.push(o);
      else if (a === 'none') g.done.push(o);
      else g.waiting.push(o);
    }
    return g;
  }, [orders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Verkäufe &amp; Re-Shipping</h1>
        <button className="btn-secondary" onClick={() => void reload()}>
          Aktualisieren
        </button>
      </div>

      {error && <div className="card text-red-600">{error}</div>}

      <Section
        title="Aktion erforderlich"
        emphasis
        subtitle="Pakete angekommen oder Temu-Probleme"
        rows={grouped.action}
        emptyText="Aktuell nichts zu tun."
        loading={loading}
      />
      <Section
        title="Unterwegs"
        subtitle="Temu-Pakete in Zustellung"
        rows={grouped.waiting}
        emptyText="Keine offenen Pakete."
        loading={loading}
      />
      <Section
        title="Abgeschlossen"
        subtitle="Bereits an Käufer versandt"
        rows={grouped.done}
        emptyText=""
        loading={loading}
        collapsible
      />
    </div>
  );
}

function Section(props: {
  title: string;
  subtitle: string;
  rows: OrderRow[];
  emptyText: string;
  loading: boolean;
  emphasis?: boolean;
  collapsible?: boolean;
}) {
  if (props.collapsible && props.rows.length === 0) return null;

  return (
    <div className={`card ${props.emphasis && props.rows.length > 0 ? 'border-amber-300 bg-amber-500/10/50' : ''}`}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">
          {props.title}{' '}
          <span className="ml-1 rounded-full bg-zinc-800 px-2 text-xs text-zinc-300">{props.rows.length}</span>
        </h2>
        <div className="text-xs text-zinc-400">{props.subtitle}</div>
      </div>
      {props.loading && props.rows.length === 0 && (
        <div className="py-3 text-center text-sm text-zinc-500">Lade…</div>
      )}
      {!props.loading && props.rows.length === 0 && props.emptyText && (
        <div className="py-3 text-center text-sm text-zinc-500">{props.emptyText}</div>
      )}
      {props.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-zinc-400">
                <th className="py-2">Sale</th>
                <th>Listing</th>
                <th>Käufer</th>
                <th>Bezahlt</th>
                <th>Temu-Status</th>
                <th>Tracking</th>
                <th>€</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((o) => {
                const action = computeAction(o);
                const a = ACTION_LABEL[action];
                return (
                  <tr key={o.sale_id} className="border-b last:border-0 align-top">
                    <td className="py-2">#{o.sale_id}</td>
                    <td className="max-w-[200px] truncate">{o.listing_title ?? `#${o.listing_id}`}</td>
                    <td>{o.buyer_name}</td>
                    <td className="text-xs text-zinc-400">{o.paid_at ?? '—'}</td>
                    <td>
                      <TemuStateBadge state={o.temu_state} />
                      {o.temu_order_id && (
                        <div className="mt-0.5 font-mono text-[10px] text-zinc-400">{o.temu_order_id}</div>
                      )}
                      {o.temu_last_error && (
                        <div
                          className="mt-1 max-w-[220px] truncate text-xs text-red-600"
                          title={o.temu_last_error}
                        >
                          {o.temu_last_error}
                        </div>
                      )}
                    </td>
                    <td className="font-mono text-xs">{o.tracking_number ?? '—'}</td>
                    <td>{o.temu_amount_eur != null ? `€${o.temu_amount_eur.toFixed(2)}` : '—'}</td>
                    <td>
                      <div className={`inline-block rounded px-2 py-1 text-xs ${a.cls}`} title={a.hint}>
                        {a.text}
                      </div>
                      <div className="mt-0.5 max-w-[260px] text-[11px] text-zinc-400">{a.hint}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TemuStateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-zinc-500">—</span>;
  const map: Record<string, string> = {
    draft: 'bg-zinc-800 text-zinc-300',
    placed: 'bg-brand-100 text-brand-700',
    shipped: 'bg-amber-100 text-amber-800',
    delivered: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-zinc-800 text-zinc-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[state] ?? 'bg-zinc-800'}`}>
      {state}
    </span>
  );
}
