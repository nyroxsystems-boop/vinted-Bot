import { useState } from 'react';
import type { Listing } from '@vinted-system/shared';
import { useListings } from '../hooks/useListings';

export function ListingsPage() {
  const { listings, loading, create, update, remove } = useListings();
  const [editor, setEditor] = useState<Partial<Listing> | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Listings &amp; Temu-Mapping</h1>
        <button className="btn-primary" onClick={() => setEditor({})}>
          + Neues Listing
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-zinc-400">
              <th className="py-2">Titel</th>
              <th>Listpreis</th>
              <th>Min. Accept</th>
              <th>Temu-URL</th>
              <th>Status</th>
              <th>Dry-Run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-zinc-500">
                  Lade…
                </td>
              </tr>
            )}
            {!loading && listings.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-zinc-500">
                  Noch keine Listings angelegt.
                </td>
              </tr>
            )}
            {listings.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="py-2">
                  <div className="font-medium">{l.title}</div>
                  <div className="text-xs text-zinc-400">{l.vinted_url}</div>
                </td>
                <td>€{l.list_price_eur.toFixed(2)}</td>
                <td className="font-semibold text-brand-700">
                  €{l.min_accept_price_eur.toFixed(2)}
                </td>
                <td className="max-w-[220px] truncate text-xs text-zinc-400">
                  {l.temu_url ?? <span className="text-amber-600">— fehlt —</span>}
                </td>
                <td>
                  <StatusBadge status={l.status} />
                </td>
                <td>{l.dry_run ? '✓' : '—'}</td>
                <td className="text-right">
                  <button className="btn-secondary" onClick={() => setEditor(l)}>
                    Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editor && (
        <ListingEditor
          initial={editor}
          onClose={() => setEditor(null)}
          onSave={async (payload) => {
            if (editor.id) {
              await update(editor.id, payload);
            } else {
              await create(payload);
            }
            setEditor(null);
          }}
          onDelete={
            editor.id
              ? async () => {
                  await remove(editor.id!);
                  setEditor(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Listing['status'] }) {
  const cls: Record<Listing['status'], string> = {
    active: 'bg-green-100 text-green-800',
    paused: 'bg-zinc-800 text-zinc-300',
    sold: 'bg-brand-100 text-brand-700',
    archived: 'bg-zinc-800 text-zinc-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls[status]}`}>{status}</span>
  );
}

function ListingEditor(props: {
  initial: Partial<Listing>;
  onClose: () => void;
  onSave: (payload: Partial<Listing>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Listing>>({
    vinted_url: '',
    title: '',
    list_price_eur: 0,
    min_accept_price_eur: 0,
    temu_url: '',
    status: 'active',
    dry_run: 0,
    ...props.initial,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Listing>(key: K, value: Listing[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-zinc-900/60 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {props.initial.id ? 'Listing bearbeiten' : 'Neues Listing'}
          </h2>
          <button className="btn-secondary" onClick={props.onClose}>
            Schließen
          </button>
        </div>

        {err && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</div>}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Titel">
            <input
              className="input"
              value={draft.title ?? ''}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label="Vinted-URL">
            <input
              className="input"
              value={draft.vinted_url ?? ''}
              onChange={(e) => set('vinted_url', e.target.value)}
            />
          </Field>
          <Field label="Listpreis €">
            <input
              type="number"
              step="0.01"
              className="input"
              value={draft.list_price_eur ?? 0}
              onChange={(e) => set('list_price_eur', Number.parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Min. Accept €">
            <input
              type="number"
              step="0.01"
              className="input"
              value={draft.min_accept_price_eur ?? 0}
              onChange={(e) => set('min_accept_price_eur', Number.parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Temu-URL">
            <input
              className="input"
              value={draft.temu_url ?? ''}
              onChange={(e) => set('temu_url', e.target.value)}
              placeholder="https://www.temu.com/..."
            />
          </Field>
          <Field label="Temu-Variante (JSON, optional)">
            <input
              className="input font-mono text-xs"
              value={
                draft.temu_variant
                  ? (typeof draft.temu_variant === 'string'
                      ? draft.temu_variant
                      : JSON.stringify(draft.temu_variant))
                  : ''
              }
              onChange={(e) => {
                try {
                  set('temu_variant', e.target.value ? JSON.parse(e.target.value) : null);
                  setErr(null);
                } catch {
                  set('temu_variant', e.target.value as unknown as Listing['temu_variant']);
                  setErr('Temu-Variante: ungültiges JSON');
                }
              }}
              placeholder='{"size":"M","color":"Schwarz"}'
            />
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={draft.status ?? 'active'}
              onChange={(e) => set('status', e.target.value as Listing['status'])}
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="sold">sold</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label="Dry-Run (Bot akzeptiert NIE selbst)">
            <label className="flex items-center gap-2 pt-1.5 text-sm">
              <input
                type="checkbox"
                checked={draft.dry_run === 1}
                onChange={(e) => set('dry_run', e.target.checked ? 1 : 0)}
              />
              Nur beobachten, nichts automatisch tun
            </label>
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            {props.onDelete && (
              <button
                className="btn-danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Listing wirklich archivieren?')) return;
                  setBusy(true);
                  await props.onDelete!();
                  setBusy(false);
                }}
              >
                Archivieren
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={props.onClose} disabled={busy}>
              Abbrechen
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onSave(draft);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{props.label}</div>
      {props.children}
    </div>
  );
}
