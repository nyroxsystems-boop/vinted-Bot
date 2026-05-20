import { useCallback, useEffect, useMemo, useState } from 'react';
import { Rocket, RotateCw, Check } from 'lucide-react';
import { api } from '../api/client';
import { toast } from '../components/Toast';
import { MARKETPLACE_BRANDS, type MarketplaceId } from '../lib/marketplace';

interface AutoListing {
  id: number;
  folder_num: number;
  title: string;
  description: string;
  price_eur: number;
  temu_price_eur: number;
  profit_margin_eur: number;
  status: 'draft' | 'approved' | 'publishing' | 'published' | 'failed' | 'archived';
  cj_variant_id: string | null;
  vinted_url: string | null;
  last_error: string | null;
  retry_count: number;
  sold_at: string | null;
  parent_folder_num: number | null;
  relist_count: number;
  photo_paths_json: string;
  updated_at: string;
}

interface Variant {
  marketplace: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  color: string;
  material: string;
  tags_json: string;
  generated_by: 'llm' | 'manual';
  updated_at: string;
}

interface StatsResponse {
  ok: boolean;
  by_status: Array<{ status: string; count: number; avg_margin: number | null }>;
  variants_by_marketplace: Array<{ marketplace: string; count: number }>;
}

interface BatchResult {
  ok: boolean;
  approved?: number;
  would_approve?: number;
  dry_run?: boolean;
  listings?: Array<{ id: number; folder_num: number; title: string }>;
  target_marketplaces?: string[] | null;
  error?: string;
}

// Marketplaces the user can pick in the Publish-Picker. Vinted is required
// (always checked, can't uncheck) because the auto-publisher pipeline still
// uses Vinted as the primary publish — crosslist runs after Vinted success.
// Other marketplaces only appear if their bot integration is `ready`.
const PUBLISH_PICK_ORDER: MarketplaceId[] = [
  'vinted', 'kleinanzeigen', 'ebay_de', 'ebay_uk',
  'depop', 'mercari', 'wallapop', 'etsy', 'grailed',
  'vestiaire', 'whatnot', 'fb_marketplace',
  'poshmark', 'leboncoin', 'marktplaats', 'willhaben',
  'shopify', 'woocommerce',
];

// useAutoListings hook
function useAutoListings() {
  const [items, setItems] = useState<AutoListing[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'published' | 'failed'>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, raw] = await Promise.all([
        api.get<StatsResponse>('/listings/stats'),
        api.get<AutoListing[]>('/auto-listings').catch(() => [] as AutoListing[]),
      ]);
      setStats(s);
      setItems(Array.isArray(raw) ? raw : ((raw as { listings?: AutoListing[] }).listings ?? []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  return { items: filtered, allItems: items, stats, loading, reload, filter, setFilter };
}

export function AutoListingsPage() {
  const { items, allItems, stats, loading, reload, filter, setFilter } = useAutoListings();
  const [batchOpen, setBatchOpen] = useState(false);
  const [minMargin, setMinMargin] = useState(10);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Publish-Picker state: selection of listings + target marketplaces.
  const [selectedFolders, setSelectedFolders] = useState<Set<number>>(new Set());
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Set<MarketplaceId>>(
    new Set<MarketplaceId>(['vinted', 'kleinanzeigen']),
  );

  // Drafts eligible to publish: status='draft' + CJ-Mapping vorhanden + Marge ≥ Filter.
  const eligibleDrafts = useMemo(
    () =>
      allItems
        .filter((i) => i.status === 'draft' && i.cj_variant_id && i.profit_margin_eur >= minMargin)
        .sort((a, b) => b.profit_margin_eur - a.profit_margin_eur),
    [allItems, minMargin],
  );

  const draftCount = allItems.filter((i) => i.status === 'draft').length;
  const eligibleDraftCount = eligibleDrafts.length;

  // Reset selection when filter changes (otherwise selected ids reference rows
  // that may no longer be in the eligible list).
  useEffect(() => {
    setSelectedFolders(new Set());
  }, [minMargin]);

  function toggleFolder(folder: number) {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  function toggleAllFolders() {
    setSelectedFolders((prev) =>
      prev.size === eligibleDrafts.length
        ? new Set()
        : new Set(eligibleDrafts.map((d) => d.folder_num)),
    );
  }

  function toggleMarketplace(id: MarketplaceId) {
    if (id === 'vinted') return; // pinned
    setSelectedMarketplaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runPublish() {
    const folder_nums = selectedFolders.size > 0 ? Array.from(selectedFolders) : undefined;
    const targetCount = selectedMarketplaces.size;
    const listingCount = folder_nums ? folder_nums.length : eligibleDraftCount;
    if (!confirm(
      `${listingCount} Listings × ${targetCount} Marktplätze publishen?\n\n` +
      `Auto-Publisher schiebt mit 1/min an Vinted und crosslist'd parallel auf die anderen.`,
    )) return;

    setBusy(true);
    try {
      const r = await api.post<BatchResult>('/listings/start-batch', {
        folder_nums,
        min_margin_eur: minMargin,
        target_marketplaces: Array.from(selectedMarketplaces),
      });
      toast.success(
        `${r.approved} Listings approved`,
        { detail: `→ ${Array.from(selectedMarketplaces).join(' · ')} · Publisher beginnt in <60 s` },
      );
      setSelectedFolders(new Set());
      setBatchOpen(false);
      void reload();
    } catch (e) {
      toast.error('Publish fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auto-Listings &amp; Variants</h1>
          <p className="text-sm text-zinc-400">
            Drafts, Variants pro Marketplace, Massen-Start. Auto-Publisher schiebt approved drafts mit 1/min.
          </p>
        </div>
        <div className="flex gap-2">
          <BulkRegenerateButton />
          <button
            className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            onClick={() => setBatchOpen(true)}
            disabled={draftCount === 0}
          >
            <Rocket size={14} /> Publish auswählen…
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats?.by_status.map(s => (
          <div
            key={s.status}
            className={`cursor-pointer rounded border bg-zinc-900/60 p-3 ${filter === s.status ? 'border-brand-500 ring-1 ring-brand-300' : ''}`}
            onClick={() => setFilter(filter === s.status ? 'all' : s.status as typeof filter)}
          >
            <div className="text-xs uppercase text-zinc-400">{s.status}</div>
            <div className="text-2xl font-bold">{s.count}</div>
            {s.avg_margin != null && <div className="text-xs text-zinc-500">avg €{s.avg_margin.toFixed(2)}</div>}
          </div>
        ))}
        <div className="rounded border bg-amber-500/10 p-3">
          <div className="text-xs uppercase text-amber-700">Variants</div>
          <div className="text-sm">
            {stats?.variants_by_marketplace.map(v => (
              <div key={v.marketplace}>{v.marketplace}: <b>{v.count}</b></div>
            ))}
          </div>
        </div>
      </div>

      {/* Publish-Picker dialog */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex w-full max-w-5xl max-h-[90vh] flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="border-b border-zinc-800 px-6 py-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
                <Rocket size={16} /> Publish auswählen
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Wähle Listings + Marktplätze. Auto-Publisher schiebt mit 1/min an Vinted und crosslist'd parallel.
              </p>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
              {/* ── Left: Listings selection ────────────────────────────── */}
              <div className="flex flex-col border-r border-zinc-800">
                <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    Mindest-Marge €
                    <input
                      type="number" min={0} step={1}
                      value={minMargin}
                      onChange={(e) => setMinMargin(Number(e.target.value))}
                      className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                    />
                  </label>
                  <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
                    <span>{eligibleDraftCount} eligible von {draftCount} drafts</span>
                    <button
                      onClick={toggleAllFolders}
                      className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
                      disabled={eligibleDraftCount === 0}
                    >
                      {selectedFolders.size === eligibleDraftCount && eligibleDraftCount > 0 ? 'Keine' : 'Alle'}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {eligibleDraftCount === 0 ? (
                    <div className="p-10 text-center text-sm text-zinc-500">
                      Keine eligible Drafts. Senke die Mindest-Marge oder erzeuge Drafts.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-zinc-900/95 text-xs uppercase text-zinc-500">
                        <tr>
                          <th className="w-10 px-3 py-2"></th>
                          <th className="w-16 px-3 py-2 text-left">Folder</th>
                          <th className="px-3 py-2 text-left">Titel</th>
                          <th className="w-20 px-3 py-2 text-right">Preis</th>
                          <th className="w-20 px-3 py-2 text-right">Marge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligibleDrafts.map((d) => {
                          const checked = selectedFolders.has(d.folder_num);
                          return (
                            <tr
                              key={d.id}
                              onClick={() => toggleFolder(d.folder_num)}
                              className={`cursor-pointer border-t border-zinc-800/60 hover:bg-zinc-900/50 ${checked ? 'bg-brand-600/10' : ''}`}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleFolder(d.folder_num)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-zinc-400">#{d.folder_num}</td>
                              <td className="truncate px-3 py-2 text-zinc-200">{d.title}</td>
                              <td className="px-3 py-2 text-right text-zinc-300">€{d.price_eur.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-medium text-emerald-400">€{d.profit_margin_eur.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ── Right: Marketplace selection ─────────────────────────── */}
              <div className="flex flex-col">
                <div className="border-b border-zinc-800 px-4 py-3">
                  <h3 className="text-sm font-medium text-zinc-200">Marktplätze</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">Vinted ist Pflicht — andere optional.</p>
                </div>
                <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                  {PUBLISH_PICK_ORDER.map((mpId) => {
                    const brand = MARKETPLACE_BRANDS[mpId];
                    if (!brand) return null;
                    const Icon = brand.icon;
                    const isVinted = mpId === 'vinted';
                    const checked = selectedMarketplaces.has(mpId);
                    return (
                      <label
                        key={mpId}
                        className={`flex cursor-pointer items-center gap-3 rounded border px-3 py-2 transition ${
                          checked
                            ? `${brand.bgTint} border-transparent ring-1 ${brand.ring}`
                            : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/40'
                        } ${isVinted ? 'cursor-not-allowed opacity-90' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isVinted}
                          onChange={() => toggleMarketplace(mpId)}
                          className="cursor-pointer disabled:cursor-not-allowed"
                        />
                        <Icon size={14} className={brand.text} />
                        <span className="flex-1 text-sm text-zinc-200">{brand.label}</span>
                        {isVinted && <span className="text-[10px] uppercase tracking-wider text-zinc-500">Pflicht</span>}
                        {checked && !isVinted && <Check size={12} className={brand.text} />}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
              <div className="text-sm text-zinc-400">
                <b className="text-zinc-100">{selectedFolders.size > 0 ? selectedFolders.size : eligibleDraftCount}</b>
                {' '}Listings × <b className="text-zinc-100">{selectedMarketplaces.size}</b> Marktplätze
                {selectedFolders.size === 0 && eligibleDraftCount > 0 && (
                  <span className="ml-1 text-xs text-zinc-500">(keine selektiert → alle eligible)</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
                  onClick={() => setBatchOpen(false)}
                >
                  Abbrechen
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  onClick={runPublish}
                  disabled={busy || eligibleDraftCount === 0 || selectedMarketplaces.size === 0}
                >
                  {busy ? '…' : <><Rocket size={14} /> Publish</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Listings table */}
      <div className="overflow-x-auto rounded border bg-zinc-900/60">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/40 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Folder</th>
              <th>Titel</th>
              <th>Preis</th>
              <th>Marge</th>
              <th>CJ</th>
              <th>Re-List</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="py-6 text-center text-zinc-500">Lade…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-zinc-500">Keine Listings für Filter „{filter}".</td></tr>
            )}
            {items.map(i => (
              <ListingRow
                key={i.id}
                item={i}
                expanded={expandedId === i.id}
                onToggle={() => setExpandedId(expandedId === i.id ? null : i.id)}
                onChanged={() => void reload()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkRegenerateButton() {
  const [open, setOpen] = useState(false);
  const [mp, setMp] = useState<'vinted' | 'kleinanzeigen' | 'ebay_de'>('vinted');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm(`Alle ${mp}-Variants löschen und neu generieren? Worker braucht ~5 min pro 12 Listings.`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; cleared: number; message: string }>('/listings/variants/regenerate-all', {
        marketplace: mp, status_filter: statusFilter || undefined,
      });
      toast.success(`${r.cleared} Variants gelöscht`, { detail: 'Variant-Generator beginnt in <5 min.' });
      setOpen(false);
    } finally { setBusy(false); }
  }
  return (
    <>
      <button className="inline-flex items-center gap-1.5 rounded border px-3 py-2 text-sm" onClick={() => setOpen(true)}><RotateCw size={13} /> Variants regen</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-zinc-900/60 p-6 shadow-xl">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><RotateCw size={16} /> Bulk-Regenerate Variants</h2>
            <p className="mb-3 text-sm text-zinc-400">
              Löscht alle Variants für den gewählten Marketplace. variant-generator regeneriert in &lt;5 min.
              LLM-Kosten: ~$0.005 pro Variant.
            </p>
            <label className="mb-2 block text-sm">
              Marketplace
              <select value={mp} onChange={e => setMp(e.target.value as typeof mp)} className="mt-1 w-full rounded border px-2 py-1">
                <option value="vinted">Vinted</option>
                <option value="kleinanzeigen">Kleinanzeigen</option>
                <option value="ebay_de">eBay-DE</option>
              </select>
            </label>
            <label className="mb-3 block text-sm">
              Status-Filter (optional)
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="mt-1 w-full rounded border px-2 py-1">
                <option value="">alle</option>
                <option value="draft">nur drafts</option>
                <option value="approved">nur approved</option>
                <option value="published">nur published</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button className="rounded border px-3 py-1 text-sm" onClick={() => setOpen(false)}>Abbrechen</button>
              <button className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50" onClick={run} disabled={busy}>
                {busy ? '…' : <><RotateCw size={13} /> Regenerate</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatusBadge({ s }: { s: AutoListing['status'] }) {
  const colors: Record<string, string> = {
    draft: 'bg-zinc-800 text-zinc-300',
    approved: 'bg-blue-100 text-blue-700',
    publishing: 'bg-amber-100 text-amber-700',
    published: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    archived: 'bg-zinc-800 text-zinc-400',
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[s] ?? 'bg-zinc-800'}`}>{s}</span>;
}

function ListingRow({ item, expanded, onToggle, onChanged }: { item: AutoListing; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  async function approve() { await api.post(`/listings/${item.id}/approve`, {}); onChanged(); }
  async function unapprove() { await api.post(`/listings/${item.id}/unapprove`, {}); onChanged(); }

  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-zinc-900/40" onClick={onToggle}>
        <td className="px-3 py-2 font-mono text-xs">#{item.folder_num}</td>
        <td className="max-w-xs truncate">{item.title}</td>
        <td>€{item.price_eur.toFixed(2)}</td>
        <td className={item.profit_margin_eur > 5 ? 'font-semibold text-green-700' : 'text-amber-700'}>
          €{item.profit_margin_eur.toFixed(2)}
        </td>
        <td className="text-xs">{item.cj_variant_id ? '✓' : '—'}</td>
        <td className="text-xs">{item.relist_count > 0 ? `×${item.relist_count}` : ''}</td>
        <td><StatusBadge s={item.status} /></td>
        <td className="px-3" onClick={e => e.stopPropagation()}>
          {item.status === 'draft' && <button onClick={approve} className="text-xs text-brand-600 hover:underline">Approve</button>}
          {item.status === 'approved' && <button onClick={unapprove} className="text-xs text-zinc-400 hover:underline">Zurück</button>}
          {item.last_error && <span title={item.last_error} className="ml-2 text-xs text-red-500">⚠</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-zinc-900/40">
          <td colSpan={8} className="px-3 py-3">
            <VariantsEditor autoListingId={item.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function VariantsEditor({ autoListingId }: { autoListingId: number }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ ok: boolean; variants: Variant[] }>(`/listings/${autoListingId}/variants`);
      setVariants(r.variants);
    } finally { setLoading(false); }
  }, [autoListingId]);

  useEffect(() => { void load(); }, [load]);

  const marketplaces = ['vinted', 'kleinanzeigen', 'ebay_de'] as const;

  async function regenerate(mp: string) {
    setBusy(true);
    try {
      await api.post(`/listings/${autoListingId}/variants/${mp}/regenerate`, {});
      await load();
    } finally { setBusy(false); }
  }

  if (loading) return <div className="text-sm text-zinc-400">Lade Variants…</div>;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {marketplaces.map(mp => {
        const v = variants.find(x => x.marketplace === mp);
        return (
          <div key={mp} className="rounded border bg-zinc-900/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold uppercase text-xs">{mp}</div>
              <div className="flex gap-2">
                <button onClick={() => void regenerate(mp)} disabled={busy} className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline disabled:opacity-50">
                  {busy ? '…' : <><RotateCw size={11} /> LLM</>}
                </button>
                <button onClick={() => setEditing(editing === mp ? null : mp)} className="text-xs text-zinc-400 hover:underline">
                  {editing === mp ? 'fertig' : 'edit'}
                </button>
              </div>
            </div>
            {!v ? (
              <div className="text-xs text-amber-600">Noch keine Variante — Generator läuft im Hintergrund.</div>
            ) : editing === mp ? (
              <VariantEditForm
                v={v}
                onSave={async (payload) => {
                  setBusy(true);
                  await api.put(`/listings/${autoListingId}/variants/${mp}`, payload).finally(() => setBusy(false));
                  setEditing(null);
                  await load();
                }}
              />
            ) : (
              <>
                <div className="mb-1 text-sm font-medium">{v.title}</div>
                <div className="mb-1 line-clamp-4 text-xs text-zinc-400 whitespace-pre-wrap">{v.description}</div>
                <div className="text-xs text-zinc-500">
                  Kat: {v.category} · Größe: {v.size} · {v.condition}
                  {v.generated_by === 'manual' && <span className="ml-1 rounded bg-blue-100 px-1 text-blue-700">manuell</span>}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VariantEditForm({ v, onSave }: { v: Variant; onSave: (payload: Partial<Variant>) => Promise<void> }) {
  const [title, setTitle] = useState(v.title);
  const [description, setDescription] = useState(v.description);
  const [category, setCategory] = useState(v.category);
  const [size, setSize] = useState(v.size);

  return (
    <div className="space-y-1.5 text-xs">
      <input value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded border px-2 py-1" placeholder="Titel" />
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} className="w-full rounded border px-2 py-1" placeholder="Beschreibung" />
      <div className="flex gap-1.5">
        <input value={category} onChange={e => setCategory(e.target.value)} className="flex-1 rounded border px-2 py-1" placeholder="Kategorie" />
        <input value={size} onChange={e => setSize(e.target.value)} className="w-16 rounded border px-2 py-1" placeholder="S" />
      </div>
      <button
        className="rounded bg-brand-600 px-2 py-1 text-white"
        onClick={() => void onSave({ title, description, category, size, brand: v.brand, condition: v.condition, color: v.color, material: v.material })}
      >Speichern</button>
    </div>
  );
}
