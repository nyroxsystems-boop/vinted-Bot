import { useState, useCallback } from 'react';
import { api } from '../api/client';
import { Search, Plus, Package, MapPin, DollarSign, Star } from 'lucide-react';

interface CJProduct {
  pid: string;
  productName: string;
  productNameEn: string;
  productImage: string;
  categoryName: string;
  sellPrice: number;
  productWeight: number;
  variants: Array<{
    vid: string;
    variantName: string;
    variantNameEn: string;
    variantImage: string;
    sellPrice: number;
  }>;
}

interface CJProductMapping {
  id: number;
  folder_num: number;
  cj_product_id: string;
  cj_variant_id: string;
  cj_product_url: string | null;
  cost_eur: number | null;
  shipping_eur: number | null;
  warehouse: string;
  title?: string;
  sell_price_eur?: number;
}

export function CJProductsPage() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<CJProduct[]>([]);
  const [mappings, setMappings] = useState<CJProductMapping[]>([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'search' | 'mapped'>('mapped');
  const [linkModal, setLinkModal] = useState<{
    product: CJProduct;
    variant: CJProduct['variants'][0];
  } | null>(null);
  const [linkFolderNum, setLinkFolderNum] = useState('');

  const loadMappings = useCallback(async () => {
    try {
      const res = await api.get<{ ok: boolean; products: CJProductMapping[] }>('/cj/products');
      setMappings(res.products ?? []);
    } catch (err) {
      console.error('Load mappings failed', err);
    }
  }, []);

  useState(() => { void loadMappings(); });

  const search = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const res = await api.get<{ ok: boolean; products: CJProduct[] }>(
        `/cj/search?keyword=${encodeURIComponent(keyword)}&limit=20`,
      );
      setResults(res.products ?? []);
      setTab('search');
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setSearching(false);
    }
  };

  const linkProduct = async (
    product: CJProduct,
    variant: CJProduct['variants'][0],
    folderNum: number,
  ) => {
    try {
      await api.post('/cj/products', {
        folder_num: folderNum,
        cj_product_id: product.pid,
        cj_variant_id: variant.vid,
        cj_product_url: `https://cjdropshipping.com/product/${product.pid}`,
        cost_eur: variant.sellPrice,
        warehouse: 'CN',
      });
      setLinkModal(null);
      setLinkFolderNum('');
      void loadMappings();
    } catch (err) {
      console.error('Link failed', err);
    }
  };

  const unlinkProduct = async (id: number) => {
    try {
      await api.del(`/cj/products/${id}`);
      void loadMappings();
    } catch (err) {
      console.error('Unlink failed', err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CJ Produkte</h1>
        <p className="text-sm text-slate-500">
          Suche CJ-Produkte und verknüpfe sie mit deinen Folder-Nummern
        </p>
      </div>

      {/* ── Search Bar ──────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Produkt auf CJ suchen (z.B. 'hoodie', 'summer dress')…"
            className="input w-full pl-10"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
        </div>
        <button
          onClick={() => void search()}
          disabled={searching}
          className="btn-primary whitespace-nowrap"
        >
          {searching ? 'Sucht…' : 'Suchen'}
        </button>
      </div>

      {/* ── Tab Switcher ────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          onClick={() => setTab('mapped')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === 'mapped' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Verknüpfte Produkte ({mappings.length})
        </button>
        <button
          onClick={() => setTab('search')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === 'search' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Suchergebnisse ({results.length})
        </button>
      </div>

      {/* ── Mapped Products ─────────────────────────────────────────── */}
      {tab === 'mapped' && (
        <div className="card overflow-hidden p-0">
          {mappings.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              Noch keine CJ-Produkte verknüpft. Nutze die Suche um Produkte zu finden
              und mit deinen Ordnern zu verbinden.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Ordner</th>
                  <th className="px-4 py-3">Titel</th>
                  <th className="px-4 py-3">CJ Product ID</th>
                  <th className="px-4 py-3">Variante</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3 text-right">EK</th>
                  <th className="px-4 py-3 text-right">VK</th>
                  <th className="px-4 py-3 text-right">Marge</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {mappings.map((m) => {
                  const margin = m.sell_price_eur && m.cost_eur
                    ? m.sell_price_eur - m.cost_eur
                    : null;
                  return (
                    <tr key={m.id} className="hover:bg-slate-25 transition">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">
                        #{m.folder_num}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {m.title?.slice(0, 30) ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {m.cj_product_id}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {m.cj_variant_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <MapPin size={10} />
                          {m.warehouse}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">
                        {m.cost_eur ? `€${m.cost_eur.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                        {m.sell_price_eur ? `€${m.sell_price_eur.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${
                        margin && margin > 0 ? 'text-rose-600' : 'text-red-500'
                      }`}>
                        {margin !== null ? `€${margin.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void unlinkProduct(m.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Search Results ──────────────────────────────────────────── */}
      {tab === 'search' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.length === 0 ? (
            <div className="col-span-full p-8 text-center text-slate-400">
              Starte eine Suche um CJ-Produkte zu finden.
            </div>
          ) : (
            results.map((product) => (
              <div key={product.pid} className="card overflow-hidden p-0">
                <div className="aspect-square bg-slate-100">
                  <img
                    src={product.productImage}
                    alt={product.productNameEn}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-slate-800 line-clamp-2">
                    {product.productNameEn || product.productName}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-rose-600">
                      ${product.sellPrice?.toFixed(2)}
                    </span>
                    <span>·</span>
                    <span>{product.categoryName}</span>
                    <span>·</span>
                    <span>{product.productWeight}g</span>
                  </div>
                  {product.variants?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {product.variants.slice(0, 5).map((v) => (
                        <button
                          key={v.vid}
                          onClick={() => setLinkModal({ product, variant: v })}
                          className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
                        >
                          <Plus size={10} />
                          {v.variantNameEn || v.variantName}
                        </button>
                      ))}
                      {product.variants.length > 5 && (
                        <span className="text-[10px] text-slate-400">
                          +{product.variants.length - 5} mehr
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Link Modal ──────────────────────────────────────────────── */}
      {linkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-lg font-semibold">Produkt verknüpfen</h2>
            <div className="text-sm text-slate-600">
              <strong>{linkModal.product.productNameEn}</strong>
              <br />
              Variante: {linkModal.variant.variantNameEn} — ${linkModal.variant.sellPrice}
            </div>
            <div>
              <label className="label">Ordner-Nummer</label>
              <input
                type="number"
                className="input"
                placeholder="z.B. 42"
                value={linkFolderNum}
                onChange={(e) => setLinkFolderNum(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void linkProduct(
                  linkModal.product,
                  linkModal.variant,
                  Number(linkFolderNum),
                )}
                disabled={!linkFolderNum}
                className="btn-primary"
              >
                Verknüpfen
              </button>
              <button onClick={() => setLinkModal(null)} className="btn-secondary">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
