// ──────────────────────────────────────────────────────────────────────────────
// Listings grid — Vinted-style card view. Each card shows: cover photo,
// title, price, status, marketplace badges. Click → opens a detail panel
// with description + all photos + variant info.
//
// Replaces the old tabular AutoListings page for the primary "Listings"
// view in the slim sidebar. The full table is still available at /auto-listings.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { CheckCircle2, Clock, AlertCircle, Sparkles, Send, X, Image as ImageIcon, ChevronLeft, ChevronRight, Search, Inbox, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmtEur, fmtNum } from '../lib/format';
import { photoUrl, listingPhotos, hasGeneratedPhotos } from '../lib/photos';

interface AutoListing {
  id: number;
  folder_num: number;
  title: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  color: string;
  material?: string;
  price_eur: number;
  profit_margin_eur: number;
  photo_paths: string[];
  status: 'raw' | 'draft' | 'approved' | 'publishing' | 'published' | 'failed' | 'archived';
  vinted_url?: string | null;
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
  material?: string;
  price_eur?: number;
}

const STATUS_FILTERS: Array<{ id: 'all' | AutoListing['status']; label: string; icon?: typeof CheckCircle2 }> = [
  { id: 'all',        label: 'Alle' },
  { id: 'raw',        label: 'Roh (CJ-Stock)', icon: ImageIcon },
  { id: 'draft',      label: 'Draft',      icon: Clock },
  { id: 'approved',   label: 'Approved',   icon: Sparkles },
  { id: 'publishing', label: 'Publishing', icon: Send },
  { id: 'published',  label: 'Live',       icon: CheckCircle2 },
  { id: 'failed',     label: 'Failed',     icon: AlertCircle },
];

function StatusBadge({ s }: { s: AutoListing['status'] }) {
  const map: Record<AutoListing['status'], string> = {
    raw: 'badge-warn',          // amber — "needs work" not catastrophic
    draft: 'badge-muted',
    approved: 'badge-info',
    publishing: 'badge-warn',
    published: 'badge-good',
    failed: 'badge-bad',
    archived: 'badge-muted',
  };
  return <span className={map[s] ?? 'badge-muted'}>{s}</span>;
}

function ListingCard({
  l,
  variant,
  onOpen,
}: {
  l: AutoListing;
  variant: Variant | null;
  onOpen: () => void;
}) {
  const displayTitle = variant?.title || l.title.replace(/^\[Import\]\s*/, '');
  const photos = listingPhotos(l.photo_paths);
  const photo = photos[0];
  const isStock = !hasGeneratedPhotos(l.photo_paths) && photos.length > 0;
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left flex flex-col rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900 transition shadow-lg shadow-black/20"
    >
      <div
        className="relative bg-zinc-800 overflow-hidden"
        style={{ aspectRatio: '3 / 4', minHeight: '220px' }}
      >
        {photo && !broken ? (
          <img
            src={photoUrl(photo)}
            alt={displayTitle}
            loading="lazy"
            onError={() => setBroken(true)}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-1">
            <ImageIcon size={32} />
            <span className="text-[10px] font-medium">{photo ? 'Datei fehlt' : 'keine Fotos'}</span>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {isStock && (
            <span className="rounded bg-amber-500/20 ring-1 ring-amber-500/40 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
              Stock
            </span>
          )}
          <StatusBadge s={l.status} />
        </div>
        {photos.length > 1 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200">
            {photos.length}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-[13px] font-semibold text-zinc-100 line-clamp-2 leading-snug">
          {displayTitle}
        </div>
        <div className="mt-1.5 flex items-end justify-between">
          <div>
            <div className="tabular text-lg font-bold text-zinc-100">{fmtEur(l.price_eur)}</div>
            <div className="text-[10px] text-zinc-500">
              #{l.folder_num} · {l.size ?? '–'} · {variant?.color ?? l.color}
            </div>
          </div>
          {l.profit_margin_eur > 0 && (
            <div className="text-[11px] font-semibold text-rose-400 tabular">
              +{fmtEur(l.profit_margin_eur)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function DetailModal({
  l,
  variant,
  onClose,
  onPrev,
  onNext,
  position,
  total,
}: {
  l: AutoListing;
  variant: Variant | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  position: number;
  total: number;
}) {
  const displayTitle = variant?.title || l.title.replace(/^\[Import\]\s*/, '');
  const displayDesc = variant?.description || l.description;

  // Arrow-key navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
    >
      {/* Left chevron */}
      <button
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        disabled={position <= 0}
        className="fixed left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition disabled:opacity-30 disabled:cursor-not-allowed z-50"
        aria-label="Vorheriges Listing"
      >
        <ChevronLeft size={22} />
      </button>
      {/* Right chevron */}
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        disabled={position >= total - 1}
        className="fixed right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition disabled:opacity-30 disabled:cursor-not-allowed z-50"
        aria-label="Nächstes Listing"
      >
        <ChevronRight size={22} />
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card max-w-4xl w-full max-h-[90vh] overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge s={l.status} />
              <span className="text-[11px] text-zinc-500">
                #{l.folder_num} · ID {l.id} · {position + 1} / {total}
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-100 truncate">{displayTitle}</h2>
          </div>
          <button onClick={onClose} className="ml-3 p-2 rounded-lg hover:bg-zinc-800" aria-label="Schließen">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
          <PhotoGallery
            photos={listingPhotos(l.photo_paths)}
            alt={displayTitle}
          />


          <div className="space-y-4 text-sm">
            <div>
              <div className="kpi-label">Preis</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="kpi-value">{fmtEur(l.price_eur)}</span>
                {l.profit_margin_eur > 0 && (
                  <span className="text-rose-400 font-semibold">
                    +{fmtEur(l.profit_margin_eur)} Marge
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategorie" value={variant?.category ?? l.category} />
              <Field label="Marke"     value={variant?.brand ?? l.brand} />
              <Field label="Größe"     value={variant?.size ?? l.size} />
              <Field label="Zustand"   value={variant?.condition ?? l.condition} />
              <Field label="Farbe"     value={variant?.color ?? l.color} />
              <Field label="Material"  value={variant?.material ?? l.material ?? '–'} />
            </div>

            <div>
              <div className="kpi-label">Beschreibung</div>
              <div className="mt-1 text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {displayDesc}
              </div>
            </div>

            {l.vinted_url && (
              <div>
                <div className="kpi-label">Vinted-Link</div>
                <a
                  href={l.vinted_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-rose-400 hover:text-rose-300 underline break-all text-[13px]"
                >
                  {l.vinted_url}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoGallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [bigBroken, setBigBroken] = useState(false);

  // Reset selection when the photo set changes (e.g. user navigated to next listing).
  useEffect(() => {
    setSelected(0);
    setBigBroken(false);
  }, [photos]);

  // Reset broken state when the user picks a different photo.
  useEffect(() => {
    setBigBroken(false);
  }, [selected]);

  // Lightbox keyboard nav.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      else if (e.key === 'ArrowLeft') setSelected((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setSelected((i) => Math.min(photos.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, photos.length]);

  if (photos.length === 0) {
    return (
      <div className="space-y-3">
        <div className="aspect-[3/4] bg-zinc-800 rounded-lg flex flex-col items-center justify-center text-zinc-600 gap-2">
          <ImageIcon size={40} />
          <span className="text-sm">Keine Fotos im Ordner</span>
          <Link to="/studio" className="text-xs text-rose-400 hover:text-rose-300 underline">
            Bilder generieren →
          </Link>
        </div>
      </div>
    );
  }

  const big = photos[selected]!;
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block w-full overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-zinc-800 transition hover:ring-zinc-700"
        aria-label="Bild vergrößern"
      >
        {bigBroken ? (
          <div className="aspect-[3/4] flex flex-col items-center justify-center gap-2 text-zinc-600">
            <ImageIcon size={36} />
            <span className="text-xs font-medium">Datei fehlt</span>
            <span className="text-[10px] font-mono text-zinc-700 break-all px-4 text-center">{big}</span>
          </div>
        ) : (
          <img
            src={photoUrl(big)}
            alt={alt}
            onError={() => setBigBroken(true)}
            className="w-full aspect-[3/4] object-cover transition group-hover:opacity-95"
          />
        )}
      </button>

      {photos.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelected(i)}
              className={`relative aspect-square overflow-hidden rounded bg-zinc-800 ring-1 transition ${
                i === selected
                  ? 'ring-rose-500 ring-2'
                  : 'ring-zinc-800 hover:ring-zinc-600'
              }`}
              aria-label={`Bild ${i + 1} von ${photos.length}`}
            >
              <img
                src={photoUrl(p)}
                alt=""
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }}
              />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-8 cursor-zoom-out"
        >
          <img
            src={photoUrl(big)}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
          />
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelected((i) => Math.max(0, i - 1)); }}
                disabled={selected === 0}
                className="fixed left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
                aria-label="Vorheriges Bild"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelected((i) => Math.min(photos.length - 1, i + 1)); }}
                disabled={selected === photos.length - 1}
                className="fixed right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
                aria-label="Nächstes Bild"
              >
                <ChevronRight size={22} />
              </button>
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/80 px-3 py-1 text-xs font-semibold text-zinc-200 ring-1 ring-zinc-700">
                {selected + 1} / {photos.length}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="fixed right-4 top-4 p-2 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="kpi-label">{label}</div>
      <div className="mt-0.5 text-zinc-200">{value || '–'}</div>
    </div>
  );
}

export function ListingsGridPage() {
  const [items, setItems] = useState<AutoListing[]>([]);
  const [variants, setVariants] = useState<Record<number, Variant>>({});
  const [filter, setFilter] = useState<'all' | AutoListing['status']>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AutoListing | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get<AutoListing[]>('/auto-listings');
      setItems(data);
      // Fetch variants for visible items (cheap because we cache locally)
      const variantMap: Record<number, Variant> = {};
      await Promise.all(
        data.slice(0, 50).map(async (l) => {
          try {
            const v = await api.get<{ variants: Variant[] }>(`/listings/${l.id}/variants`);
            const vinted = v.variants?.find((x) => x.marketplace === 'vinted');
            if (vinted) variantMap[l.id] = vinted;
          } catch { /* */ }
        }),
      );
      setVariants(variantMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const t = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const filtered = items.filter((l) => {
    if (filter !== 'all' && l.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const title = (variants[l.id]?.title || l.title).toLowerCase();
      if (!title.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Listings</h1>
          <p className="page-subtitle">
            {loading ? (
              <span className="skeleton inline-block h-4 w-40 align-middle" />
            ) : (
              `${fmtNum(filtered.length)} von ${fmtNum(items.length)} Listings`
            )}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Titel suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Suche leeren"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const count = f.id === 'all' ? items.length : items.filter((i) => i.status === f.id).length;
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
                active
                  ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40'
                  : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {f.icon && <f.icon size={13} />}
              {f.label}
              <span className="tabular text-zinc-500">{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card aspect-[3/4] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          {search || filter !== 'all' ? (
            <>
              <Filter size={32} className="mb-3 text-zinc-600" strokeWidth={1.5} />
              <div className="text-base font-semibold text-zinc-200">Kein Treffer für aktuellen Filter</div>
              <div className="mt-1 text-sm text-zinc-500">
                {search ? `Suche „${search}"` : `Filter „${filter}"`} — versuche es mit anderen Kriterien.
              </div>
              <button
                type="button"
                onClick={() => { setSearch(''); setFilter('all'); }}
                className="btn-secondary mt-5"
              >
                Filter zurücksetzen
              </button>
            </>
          ) : (
            <>
              <Inbox size={36} className="mb-3 text-zinc-600" strokeWidth={1.5} />
              <div className="text-base font-semibold text-zinc-200">Noch keine Listings angelegt</div>
              <div className="mt-1 max-w-sm text-sm text-zinc-500">
                Lade Produkt-Fotos hoch oder importiere CJ-Produkte — die KI generiert daraus deine
                ersten Inserate.
              </div>
              <Link to="/products" className="btn-primary mt-5">
                Produkte importieren
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((l) => (
            <ListingCard
              key={l.id}
              l={l}
              variant={variants[l.id] ?? null}
              onOpen={() => setSelected(l)}
            />
          ))}
        </div>
      )}

      {selected && (() => {
        const idx = filtered.findIndex((x) => x.id === selected.id);
        const goPrev = () => { if (idx > 0) setSelected(filtered[idx - 1]!); };
        const goNext = () => { if (idx < filtered.length - 1) setSelected(filtered[idx + 1]!); };
        return (
          <DetailModal
            l={selected}
            variant={variants[selected.id] ?? null}
            onClose={() => setSelected(null)}
            onPrev={goPrev}
            onNext={goNext}
            position={idx}
            total={filtered.length}
          />
        );
      })()}
    </div>
  );
}
