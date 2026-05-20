// ──────────────────────────────────────────────────────────────────────────────
// Sales grid — Vinted-style card view for sold items. Each card shows:
//   • Product photo (cover) with "VERKAUFT" diagonal banner
//   • Title
//   • Sale price (big)
//   • EK (cost) — smaller, gray
//   • Margin in green (€ + %)
//   • Sold-count badge ("3x" — if relisted)
//   • Marketplace tag
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { Image as ImageIcon, ExternalLink, TrendingUp, Inbox, AlertTriangle, Search, X, Filter, Plus } from 'lucide-react';
import { useMarketplace } from '../components/MarketplaceContext';
import { fmtEur, fmtDate, fmtPct } from '../lib/format';
import { CountUp } from '../components/CountUp';
import { getBrand } from '../lib/marketplace';
import { MarketplaceBadge } from '../components/MarketplaceBadge';
import { photoUrl, listingPhotos } from '../lib/photos';
import { ManualSaleModal } from '../components/ManualSaleModal';

interface Sale {
  id: number;
  folder_num: number;
  title: string;
  photo_paths: string[];
  sale_price: number;
  ek_price: number;
  margin: number;
  margin_pct: number;
  relist_count: number;
  sold_count: number;
  sold_at: string | null;
  marketplace: string;
  external_url: string | null;
}

function SaleCard({ s }: { s: Sale }) {
  const photo = listingPhotos(s.photo_paths)[0];
  const brand = getBrand(s.marketplace);
  return (
    <a
      href={s.external_url ?? '#'}
      target={s.external_url ? '_blank' : '_self'}
      rel="noreferrer"
      className={`group block overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-lg shadow-black/20 transition hover:bg-zinc-900 hover:${brand.ring.replace('ring-', 'border-')}`}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-zinc-800">
        {photo ? (
          <img
            src={photoUrl(photo)}
            alt={s.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover grayscale-[20%] transition-all duration-300 group-hover:grayscale-0"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
            <ImageIcon size={32} />
          </div>
        )}
        {/* Diagonal VERKAUFT banner — emerald = profit win */}
        <div className="absolute -right-12 top-4 rotate-45 bg-rose-500 px-12 py-1 text-[11px] font-extrabold tracking-widest text-rose-950 shadow-lg">
          VERKAUFT
        </div>
        {/* Sold-count badge top-left */}
        {s.sold_count > 1 && (
          <div className="absolute left-2 top-2 rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
            {s.sold_count}× verkauft
          </div>
        )}
        {/* Marketplace brand chip bottom-left */}
        <div className="absolute bottom-2 left-2">
          <MarketplaceBadge id={s.marketplace} size="sm" />
        </div>
        {/* External link icon */}
        {s.external_url && (
          <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-1 text-zinc-200 backdrop-blur">
            <ExternalLink size={11} />
          </div>
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="text-[13px] font-semibold text-zinc-100 line-clamp-2 leading-snug min-h-[36px]">
          {s.title}
        </div>

        {/* Prices row */}
        <div className="flex items-end justify-between">
          <div>
            <div className="kpi-label">Verkauft für</div>
            <div className="tabular text-xl font-bold text-zinc-100">{fmtEur(s.sale_price)}</div>
          </div>
          <div className="text-right">
            <div className="kpi-label">EK</div>
            <div className="tabular text-sm font-semibold text-zinc-400 line-through">
              {fmtEur(s.ek_price)}
            </div>
          </div>
        </div>

        {/* Margin */}
        <div className="flex items-center justify-between rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
            <TrendingUp size={12} />
            Gewinn
          </div>
          <div className="tabular text-sm font-bold text-rose-300">
            +{fmtEur(s.margin)}
            <span className="ml-1 text-[10px] text-rose-400/70">({s.margin_pct}%)</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${brand.dot}`} />
            #{s.folder_num}
          </span>
          {s.sold_at && <span>{fmtDate(s.sold_at)}</span>}
        </div>
      </div>
    </a>
  );
}

function SummaryRow({ sales }: { sales: Sale[] }) {
  const total_revenue = sales.reduce((a, s) => a + s.sale_price, 0);
  const total_cost = sales.reduce((a, s) => a + s.ek_price, 0);
  const total_profit = total_revenue - total_cost;
  const margin_pct = total_revenue > 0 ? (total_profit / total_revenue) * 100 : 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="card-hover">
        <div className="kpi-label">Umsatz gesamt</div>
        <div className="kpi-value mt-1 text-zinc-100">
          <CountUp value={total_revenue} format={fmtEur} />
        </div>
        <div className="mt-1 text-xs text-zinc-500">{sales.length} Verkäufe</div>
      </div>
      <div className="card-hover">
        <div className="kpi-label">Wareneinkauf</div>
        <div className="kpi-value mt-1 text-zinc-400">
          <CountUp value={total_cost} format={fmtEur} />
        </div>
        <div className="mt-1 text-xs text-zinc-500">Selbstkosten</div>
      </div>
      <div className="card-hover">
        <div className="kpi-label">Gewinn</div>
        <div className="kpi-value mt-1 text-rose-400">
          <CountUp value={total_profit} format={fmtEur} />
        </div>
        <div className="mt-1 text-xs text-rose-400/70">
          {fmtPct(margin_pct, { digits: 0 })} Marge
        </div>
      </div>
    </div>
  );
}

type SortKey = 'recent' | 'margin' | 'price' | 'most_sold';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'recent',    label: 'Neueste zuerst' },
  { id: 'margin',    label: 'Höchste Marge' },
  { id: 'price',     label: 'Höchster Preis' },
  { id: 'most_sold', label: 'Häufigste Verkäufe' },
];

export function SalesGridPage() {
  const { query } = useMarketplace();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [manualOpen, setManualOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get<Sale[]>(`/home/sales${query}`);
      setSales(data);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadDemo = useCallback(async () => {
    try {
      // Use Kleider #1 (auto_listing id 771) as a demo entry
      const listing = await api.get<{
        id: number; folder_num: number; title: string; price_eur: number;
        cj_cost_eur: number | null; temu_price_eur: number; photo_paths: string[];
      }>('/auto-listings/771');
      const ek = listing.cj_cost_eur ?? listing.temu_price_eur ?? 8.50;
      const sale: Sale = {
        id: listing.id,
        folder_num: listing.folder_num,
        title: 'Summer Vibe Pleated Dress Größe S',
        photo_paths: listing.photo_paths,
        sale_price: listing.price_eur,
        ek_price: ek,
        margin: Math.round((listing.price_eur - ek) * 100) / 100,
        margin_pct: ek > 0 ? Math.round((listing.price_eur - ek) / listing.price_eur * 100) : 0,
        relist_count: 2,    // pretend it was resold twice
        sold_count: 3,
        sold_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
        marketplace: 'vinted',
        external_url: 'https://www.vinted.de/items/8785337276',
      };
      setSales([sale]);
      setDemoMode(true);
    } catch (err) {
      console.warn('Demo load failed', err);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const t = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sales.filter((s) => s.title.toLowerCase().includes(q)) : sales;
    const sorted = [...filtered];
    switch (sort) {
      case 'margin':    sorted.sort((a, b) => b.margin - a.margin); break;
      case 'price':     sorted.sort((a, b) => b.sale_price - a.sale_price); break;
      case 'most_sold': sorted.sort((a, b) => b.sold_count - a.sold_count); break;
      case 'recent':
      default:
        sorted.sort((a, b) => {
          const ta = a.sold_at ? new Date(a.sold_at).getTime() : 0;
          const tb = b.sold_at ? new Date(b.sold_at).getTime() : 0;
          return tb - ta;
        });
        break;
    }
    return sorted;
  }, [sales, search, sort]);

  return (
    <div className="space-y-6">
      <SummaryRow sales={sales} />

      {sales.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Verkauf suchen…"
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
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-rose-500/50 hover:text-rose-300"
              onClick={() => setManualOpen(true)}
              title="Bestellung manuell eintragen (z.B. KA-Direktkauf der nicht gescrapt wurde)"
            >
              <Plus size={12} /> Manueller Sale
            </button>
            <Filter size={13} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Sortieren</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card aspect-[3/4] animate-pulse" />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Inbox size={36} className="mb-3 text-zinc-600" strokeWidth={1.5} />
          <div className="text-base font-semibold text-zinc-200">Noch keine Verkäufe</div>
          <div className="mt-1 max-w-sm text-sm text-zinc-500">
            Sobald deine Listings auf Vinted, Kleinanzeigen oder eBay verkauft werden,
            erscheinen sie hier — inklusive Gewinn pro Sale und Sold-Counter.
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => setManualOpen(true)} className="btn-primary text-xs inline-flex items-center gap-1.5">
              <Plus size={13} /> Manueller Sale eintragen
            </button>
            <button onClick={() => void loadDemo()} className="btn-ghost text-xs">
              Demo-Card anzeigen
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <Filter size={28} className="mb-3 text-zinc-600" strokeWidth={1.5} />
          <div className="font-semibold text-zinc-200">Kein Treffer für „{search}"</div>
          <button type="button" onClick={() => setSearch('')} className="btn-ghost mt-4 text-xs">
            Suche zurücksetzen
          </button>
        </div>
      ) : (
        <>
          {demoMode && (
            <div className="badge-warn inline-flex">
              <AlertTriangle size={11} /> Demo-Daten — kein echter Verkauf
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visible.map((s) => <SaleCard key={`${s.id}-${s.sold_at ?? s.folder_num}`} s={s} />)}
          </div>
        </>
      )}

      {manualOpen && (
        <ManualSaleModal
          onClose={() => setManualOpen(false)}
          onCreated={() => void fetchData()}
        />
      )}
    </div>
  );
}
