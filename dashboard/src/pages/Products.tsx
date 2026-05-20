import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ImageIcon, CheckCircle2, Clock, AlertCircle, Search, RefreshCw,
  ChevronRight, FileText, Send, Square, CheckSquare, SquareCheck,
} from 'lucide-react';

interface ModelStatus { model: string; label: string; images: string[]; count: number; complete: boolean; }
interface ProductFolder {
  folderNum: number; folderName: string; folderPath: string; inputImages: string[];
  models: ModelStatus[]; totalGenerated: number; complete: boolean;
  hasListing: boolean; listing: any;
}
interface ProductsResponse { total: number; complete: number; withListings: number; products: ProductFolder[]; }

type FilterMode = 'all' | 'complete' | 'incomplete' | 'ready' | 'no-listing';

export function ProductsPage() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pushing, setPushing] = useState(false);
  const navigate = useNavigate();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const filtered = data?.products.filter(p => {
    if (search) {
      const s = search.toLowerCase();
      if (!p.folderName.toLowerCase().includes(s) && !String(p.folderNum).includes(s)) return false;
    }
    switch (filter) {
      case 'complete': return p.complete;
      case 'incomplete': return !p.complete && p.totalGenerated > 0;
      case 'ready': return p.listing?.status === 'ready';
      case 'no-listing': return !p.hasListing && p.totalGenerated > 0;
      default: return true;
    }
  }) ?? [];

  const readyProducts = data?.products.filter(p => p.listing?.status === 'ready') ?? [];
  const readyCount = readyProducts.length;

  const toggleSelect = (num: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  };

  const selectAllReady = () => {
    setSelected(new Set(readyProducts.map(p => p.folderNum)));
  };

  const deselectAll = () => setSelected(new Set());

  const pushSelected = async () => {
    setPushing(true);
    try {
      await fetch('/api/products/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_nums: [...selected] }),
      });
      setSelected(new Set());
      await fetchProducts();
    } catch (e) { console.error(e); }
    finally { setPushing(false); }
  };

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Produkte</h1>
          <p className="mt-1 text-sm text-slate-500">Ordner • Models • Anzeigen verwalten</p>
        </div>
        <button onClick={fetchProducts} disabled={loading} className="btn-secondary">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Aktualisieren
        </button>
      </div>

      {/* Stats */}
      {data && (
        <div className="mb-6 grid grid-cols-4 gap-4">
          <Stat icon={<ImageIcon size={18} className="text-slate-400" />} label="Ordner" value={data.total} />
          <Stat icon={<CheckCircle2 size={18} className="text-rose-500" />} label="Bilder fertig" value={data.complete}
            sub={`${Math.round(data.complete / Math.max(data.total, 1) * 100)}%`} />
          <Stat icon={<FileText size={18} className="text-brand-500" />} label="Anzeigen" value={data.withListings} />
          <Stat icon={<Send size={18} className="text-rose-500" />} label="Bereit zum Pushen" value={readyCount} />
        </div>
      )}

      {/* Search + Filter */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Ordner suchen..." value={search}
            onChange={e => setSearch(e.target.value)} className="input pl-9" />
        </div>
        <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
          {([['all','Alle'],['complete','Fertig'],['ready','Bereit'],['incomplete','Teilweise'],['no-listing','Ohne']] as [FilterMode, string][]).map(([m,l]) => (
            <button key={m} onClick={() => setFilter(m)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                filter === m ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}>{l}</button>
          ))}
        </div>
      </div>

      {/* Bulk select bar */}
      {readyCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <Send size={16} className="text-rose-600" />
          <span className="text-sm font-medium text-rose-800">
            {readyCount} Anzeige{readyCount !== 1 ? 'n' : ''} bereit zum Pushen
          </span>
          <div className="flex-1" />
          {selected.size > 0 ? (
            <>
              <span className="text-xs text-rose-600">{selected.size} ausgewählt</span>
              <button onClick={deselectAll} className="btn-secondary text-xs py-1 px-2">Abwählen</button>
            </>
          ) : (
            <button onClick={selectAllReady} className="btn-secondary text-xs py-1 px-2">
              <SquareCheck size={12} /> Alle auswählen
            </button>
          )}
          <button onClick={pushSelected} disabled={selected.size === 0 || pushing}
            className="btn bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 text-xs py-1.5 px-3">
            <Send size={12} /> {pushing ? 'Pushe...' : `${selected.size} auf Vinted pushen`}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Product list */}
      <div className="space-y-2">
        {filtered.map(p => {
          const isReady = p.listing?.status === 'ready';
          const isSel = selected.has(p.folderNum);
          return (
            <div key={p.folderNum}
              className={`card flex w-full items-center gap-4 p-4 transition hover:shadow-md ${
                isSel ? 'border-rose-300 bg-rose-50/30' : 'hover:border-brand-200'
              }`}>
              {/* Checkbox (only for ready) */}
              <div className="flex-shrink-0 w-6">
                {isReady && (
                  <button onClick={e => toggleSelect(p.folderNum, e)} className="text-slate-400 hover:text-rose-600">
                    {isSel ? <CheckSquare size={18} className="text-rose-600" /> : <Square size={18} />}
                  </button>
                )}
              </div>

              {/* Click area → navigate */}
              <button onClick={() => navigate(`/products/${p.folderNum}`)} className="flex flex-1 items-center gap-4 text-left">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg font-bold text-slate-600">
                  {p.folderNum}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{p.folderName}</span>
                    {p.complete && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">15/15</span>}
                    {p.listing?.status === 'ready' && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300 ring-1 ring-rose-500/30">Bereit</span>}
                    {p.listing?.status === 'draft' && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">Entwurf</span>}
                    {p.listing?.status === 'published' && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">🟢 Online</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    {p.models.map(m => (
                      <div key={m.model} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${m.complete ? 'bg-rose-500' : m.count > 0 ? 'bg-amber-400' : 'bg-slate-200'}`} />
                        <span className="text-xs text-slate-500">{m.label} <span className="text-slate-400">({m.count}/5)</span></span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-sm font-semibold text-slate-700">{p.totalGenerated}<span className="text-slate-400">/15</span></div>
                  <div className="text-[10px] text-slate-400">Bilder</div>
                </div>
                <ChevronRight size={16} className="flex-shrink-0 text-slate-300" />
              </button>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="flex flex-col items-center py-20 text-slate-400">
          <ImageIcon size={48} strokeWidth={1} />
          <p className="mt-3 text-sm">Keine Produkte gefunden</p>
        </div>
      )}

      {filtered.length > 0 && <div className="mt-4 text-center text-xs text-slate-400">{filtered.length} von {data?.total ?? 0} Ordnern</div>}
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">{icon}</div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-slate-900">{value}</span>
          {sub && <span className="text-xs font-medium text-slate-400">{sub}</span>}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}
