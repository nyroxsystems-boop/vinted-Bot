import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccountId } from '../hooks/useAccountId';
import {
  ArrowLeft, CheckCircle2, GripVertical, ImageIcon, Save, Sparkles, X, Plus,
} from 'lucide-react';

// ── Vinted-exakte Optionen (1:1 wie auf vinted.de) ──────────────────────────

const CATEGORIES = [
  'Damen > Kleider > Minikleider', 'Damen > Kleider > Midikleider',
  'Damen > Kleider > Maxikleider', 'Damen > Kleider > Sommerkleider',
  'Damen > Kleider > Cocktailkleider', 'Damen > Kleider > Abendkleider',
  'Damen > Kleider > Alltagskleider',
  'Damen > Oberteile > T-Shirts', 'Damen > Oberteile > Crop Tops',
  'Damen > Oberteile > Blusen', 'Damen > Oberteile > Kapuzenpullover',
  'Damen > Oberteile > Sweatshirts',
  'Damen > Hosen > Jeans', 'Damen > Hosen > Leggings', 'Damen > Hosen > Jogginghosen',
  'Damen > Röcke > Miniröcke', 'Damen > Röcke > Midiröcke',
  'Damen > Sportkleidung > Sport-BHs', 'Damen > Sportkleidung > Leggings',
  'Damen > Sportkleidung > Shorts', 'Damen > Sportkleidung > Tops',
  'Damen > Jacken & Mäntel > Übergangsjacken',
  'Damen > Bademode > Bikinis', 'Damen > Bademode > Badeanzüge',
];

const SIZES = [
  { label: 'XXXS / 30 / 2', value: 'XXXS' },
  { label: 'XXS / 32 / 4', value: 'XXS' },
  { label: 'XS / 34 / 6', value: 'XS' },
  { label: 'S / 36 / 8', value: 'S' },
  { label: 'M / 38 / 10', value: 'M' },
  { label: 'L / 40 / 12', value: 'L' },
  { label: 'XL / 42 / 14', value: 'XL' },
  { label: 'XXL / 44 / 16', value: 'XXL' },
  { label: 'XXXL / 46 / 18', value: 'XXXL' },
  { label: '4XL / 48 / 20', value: '4XL' },
  { label: '5XL / 50 / 22', value: '5XL' },
];

const CONDITIONS = [
  { value: 'Neu, mit Etikett', desc: 'Ein brandneuer, unbenutzter Artikel mit Etikett oder original verpackt.' },
  { value: 'Neu', desc: 'Ein brandneuer, unbenutzter Artikel ohne Etikett oder Originalverpackung.' },
  { value: 'Sehr gut', desc: 'Ein nur selten benutzter Artikel mit möglichen Unvollkommenheiten, aber sonst im Top-Zustand.' },
  { value: 'Gut', desc: 'Ein benutzter Artikel mit Gebrauchsspuren, der aber noch in gutem Zustand ist.' },
  { value: 'Befriedigend', desc: 'Ein häufig benutzter Artikel mit deutlichen Gebrauchsspuren.' },
];

const COLORS = [
  'Schwarz', 'Weiß', 'Beige', 'Grau', 'Braun', 'Rot', 'Orange', 'Gelb',
  'Grün', 'Blau', 'Lila', 'Rosa', 'Türkis', 'Gold', 'Silber', 'Weinrot',
  'Khaki', 'Creme', 'Bordeaux', 'Mint', 'Koralle', 'Mehrfarbig',
];

const MATERIALS = [
  'Polyester', 'Baumwolle', 'Elasthan', 'Viskose', 'Nylon', 'Leinen',
  'Seide', 'Satin', 'Spitze', 'Denim', 'Wolle', 'Kunstleder', 'Samt',
  'Chiffon', 'Jersey', 'Tüll', 'Mesh', 'Acryl', 'Andere',
];

const SHIPPING = [
  { value: 'Klein', desc: 'Für Artikel, die in einen großen Umschlag passen.', rec: true },
  { value: 'Mittel', desc: 'Für Artikel, die in einen Schuhkarton passen.', rec: false },
  { value: 'Groß', desc: 'Für Artikel, die in einen Umzugskarton passen.', rec: false },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelStatus { model: string; label: string; images: string[]; count: number; complete: boolean; }
interface ProductData {
  folderNum: number; folderName: string; folderPath: string;
  inputImages: string[]; models: ModelStatus[];
  totalGenerated: number; complete: boolean;
  hasListing: boolean; listing: any;
}

interface ListingForm {
  title: string; description: string; category: string; brand: string;
  size: string; condition: string; colors: string[]; material: string;
  price_eur: number; shipping: string; photos: string[];
  status: 'draft' | 'ready' | 'published';
}

const emptyForm: ListingForm = {
  title: '', description: '', category: '', brand: '',
  size: '', condition: '', colors: [], material: '',
  price_eur: 0, shipping: 'Klein', photos: [], status: 'draft',
};

// ── Component ────────────────────────────────────────────────────────────────

export function ProductDetailPage() {
  const { folderNum } = useParams<{ folderNum: string }>();
  const navigate = useNavigate();
  const accountId = useAccountId();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillMsg, setAutoFillMsg] = useState<string | null>(null);
  const [form, setForm] = useState<ListingForm>({ ...emptyForm });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>(['vinted', 'kleinanzeigen']);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [mpStatus, setMpStatus] = useState<Array<{ marketplace: string; status: string; external_url: string | null; last_error: string | null; list_price_eur: number; views: number; likes: number; messages: number; updated_at: string }>>([]);
  const [mpHealth, setMpHealth] = useState<Record<string, boolean>>({});

  const imgUrl = (p: string) => `/api/products/image?path=${encodeURIComponent(p)}`;
  const set = (key: keyof ListingForm, val: any) => { setForm(f => ({ ...f, [key]: val })); setSaved(false); };

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products/${folderNum}`);
      if (!r.ok) throw new Error(await r.text());
      const d: ProductData = await r.json();
      setProduct(d);
      if (d.listing) {
        setForm({ ...emptyForm, ...d.listing });
      } else {
        // Auto-collect all model images
        const photos: string[] = [];
        d.models.forEach(m => m.images.forEach(img => photos.push(`${d.folderPath}/${m.model}/${img}`)));
        setForm(f => ({ ...f, photos }));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [folderNum]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

  // Save listing as JSON to the product folder
  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/products/${folderNum}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, updated_at: new Date().toISOString() }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // ── Auto-Fill (LLM): füllt Title/Desc/Cat/Brand/Size/Cond/Colors/Material/Price/Shipping
  const autoFill = async () => {
    setAutoFilling(true);
    setAutoFillMsg(null);
    try {
      const r = await fetch(`/api/products/${folderNum}/auto-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: form.photos,
          hintSize: form.size || undefined,
          hintColor: form.colors[0] || undefined,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `HTTP ${r.status}`);
      }
      const data = await r.json() as {
        listing: Partial<ListingForm>;
        source: 'llm' | 'heuristic';
        warnings?: string[];
        imagesUsed?: number;
      };
      setForm(f => ({
        ...f,
        title: data.listing.title ?? f.title,
        description: data.listing.description ?? f.description,
        category: data.listing.category ?? f.category,
        brand: data.listing.brand ?? f.brand,
        size: data.listing.size ?? f.size,
        condition: data.listing.condition ?? f.condition,
        colors: Array.isArray(data.listing.colors) && data.listing.colors.length > 0
          ? data.listing.colors
          : f.colors,
        material: data.listing.material ?? f.material,
        price_eur: typeof data.listing.price_eur === 'number' && data.listing.price_eur > 0
          ? data.listing.price_eur
          : f.price_eur,
        shipping: data.listing.shipping ?? f.shipping,
      }));
      setSaved(false);
      const tag = data.source === 'llm' ? '🤖 LLM' : '⚙️ Heuristik';
      const warn = data.warnings && data.warnings.length > 0 ? ` · ${data.warnings.join(' · ')}` : '';
      setAutoFillMsg(`${tag} • ${data.imagesUsed ?? 0} Bilder${warn}`);
      setTimeout(() => setAutoFillMsg(null), 6000);
    } catch (e) {
      console.error(e);
      setAutoFillMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setAutoFillMsg(null), 8000);
    } finally {
      setAutoFilling(false);
    }
  };

  // ── Multi-Marketplace Push ──
  const fetchMarketplaceStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/products/${folderNum}/marketplace-listings`);
      if (r.ok) {
        const d = await r.json() as { listings?: typeof mpStatus };
        setMpStatus(d.listings ?? []);
      }
    } catch { /* ignore */ }
  }, [folderNum]);

  const fetchMarketplaceHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/products/marketplaces/health');
      if (r.ok) {
        const d = await r.json() as { marketplaces?: Array<{ marketplace: string; online: boolean }> };
        const map: Record<string, boolean> = {};
        (d.marketplaces ?? []).forEach(m => { map[m.marketplace] = m.online; });
        setMpHealth(map);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMarketplaceStatus();
    fetchMarketplaceHealth();
  }, [fetchMarketplaceStatus, fetchMarketplaceHealth]);

  const toggleMarketplace = (m: string) => {
    setSelectedMarketplaces(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const pushMulti = async () => {
    setPushing(true);
    setPushMsg('🚀 Push läuft im Hintergrund — Status wird hier live aktualisiert');
    try {
      await fetch(`/api/products/${folderNum}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, status: 'ready', updated_at: new Date().toISOString() }),
      });
      // Trigger — Orchestrator returnt sofort mit "publishing" Status
      const r = await fetch(`/api/products/${folderNum}/push-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaces: selectedMarketplaces, account_id: accountId }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `HTTP ${r.status}`);
      }
      await fetchMarketplaceStatus();

      // Live-Polling alle 3s bis alle ausgewählten Plattformen NICHT mehr 'publishing' sind
      const startedAt = Date.now();
      const MAX_POLL_MS = 8 * 60 * 1000; // 8 Min Hard-Cap
      const poll = async (): Promise<void> => {
        try {
          const list = await fetch(`/api/products/${folderNum}/marketplace-listings`).then(r => r.json()) as { listings: Array<{ marketplace: string; status: string; last_error: string | null; external_url: string | null }> };
          const relevant = list.listings.filter(l => selectedMarketplaces.includes(l.marketplace));
          const stillRunning = relevant.filter(l => l.status === 'publishing');
          await fetchMarketplaceStatus();

          if (stillRunning.length === 0 || Date.now() - startedAt > MAX_POLL_MS) {
            const ok = relevant.filter(l => l.status === 'active').map(l => l.marketplace);
            const fail = relevant.filter(l => l.status === 'failed');
            const okStr = ok.length > 0 ? `✅ ${ok.join(', ')}` : '';
            const failStr = fail.length > 0 ? `❌ ${fail.map(f => `${f.marketplace}: ${(f.last_error ?? '').slice(0, 60)}`).join(' • ')}` : '';
            const stillStr = stillRunning.length > 0 ? `⏳ noch laufend: ${stillRunning.map(s => s.marketplace).join(', ')}` : '';
            setPushMsg([okStr, failStr, stillStr].filter(Boolean).join(' · ') || 'fertig');
            setPushing(false);
            setTimeout(() => setPushMsg(null), 15000);
            return;
          }
          setPushMsg(`⏳ ${stillRunning.map(s => s.marketplace).join(', ')} läuft… (${Math.round((Date.now()-startedAt)/1000)}s)`);
          setTimeout(poll, 3000);
        } catch (e) {
          setPushMsg(`⚠️ Status-Polling failed: ${e instanceof Error ? e.message : String(e)}`);
          setPushing(false);
          setTimeout(() => setPushMsg(null), 10000);
        }
      };
      setTimeout(poll, 2000);
    } catch (e) {
      setPushMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
      setPushing(false);
      setTimeout(() => setPushMsg(null), 10000);
    }
  };

  // Mark as ready
  const markReady = async () => {
    const updated = { ...form, status: 'ready' as const };
    setForm(updated);
    setSaving(true);
    try {
      await fetch(`/api/products/${folderNum}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updated, updated_at: new Date().toISOString() }),
      });
      setSaved(true);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // Photo toggle
  const togglePhoto = (path: string) => {
    setSaved(false);
    setForm(f => ({
      ...f,
      photos: f.photos.includes(path) ? f.photos.filter(p => p !== path) : [...f.photos, path],
    }));
  };

  // Photo reorder drag
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const dragEnd = () => {
    if (dragIdx.current === null || overIdx.current === null) return;
    const arr = [...form.photos];
    const [item] = arr.splice(dragIdx.current, 1);
    if (item === undefined) return;
    arr.splice(overIdx.current, 0, item);
    set('photos', arr);
    dragIdx.current = overIdx.current = null;
  };

  // Color toggle (max 2)
  const toggleColor = (c: string) => {
    setSaved(false);
    setForm(f => {
      const has = f.colors.includes(c);
      if (has) return { ...f, colors: f.colors.filter(x => x !== c) };
      if (f.colors.length >= 2) return f;
      return { ...f, colors: [...f.colors, c] };
    });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  if (!product) return <div className="py-20 text-center text-slate-400">Produkt nicht gefunden</div>;

  const isComplete = form.title && form.description && form.category && form.size && form.condition && form.colors.length > 0 && form.price_eur > 0 && form.photos.length >= 1;

  return (
    <div className="pb-12">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/products')} className="btn-secondary p-2"><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Artikel verkaufen</h1>
          <p className="text-sm text-slate-500">{product.folderName} • {product.totalGenerated} Bilder</p>
        </div>
        <div className="flex items-center gap-2">
          {autoFillMsg && <span className="text-xs font-medium text-slate-600">{autoFillMsg}</span>}
          {saved && <span className="text-sm font-medium text-rose-600">✓ Gespeichert</span>}
          <button
            onClick={autoFill}
            disabled={autoFilling || form.photos.length === 0}
            title={form.photos.length === 0 ? 'Erst Fotos auswählen' : 'Alle Felder per KI ausfüllen'}
            className="btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:!bg-slate-300"
          >
            <Sparkles size={14} /> {autoFilling ? 'Füllt aus...' : 'Auto-Fill'}
          </button>
          <button onClick={save} disabled={saving} className="btn-secondary">
            <Save size={14} /> {saving ? 'Speichert...' : 'Speichern'}
          </button>
          {isComplete && form.status !== 'ready' && (
            <button onClick={markReady} className="btn-primary">
              <CheckCircle2 size={14} /> Anzeige fertigstellen
            </button>
          )}
          {form.status === 'ready' && (
            <span className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700">✅ Bereit zum Pushen</span>
          )}
        </div>
      </div>

      {/* ── Vinted Form (1:1 Layout) ─────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-4">

        {/* ── Fotos ──────────────────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">Fotos ({form.photos.length}/20)</span>
            <span className="text-[10px] text-slate-400">Drag & Drop zum Umsortieren</span>
          </div>
          {form.photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {form.photos.map((p, i) => (
                <div key={`${p}-${i}`} draggable onDragStart={() => { dragIdx.current = i; }}
                  onDragEnter={() => { overIdx.current = i; }} onDragEnd={dragEnd}
                  onDragOver={e => e.preventDefault()}
                  className="group relative h-24 w-24 cursor-grab overflow-hidden rounded-lg border border-slate-200 active:cursor-grabbing">
                  <img src={imgUrl(p)} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => togglePhoto(p)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                    <X size={10} />
                  </button>
                  <div className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-[10px] font-bold text-white">{i + 1}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-10 text-slate-400">
              <Plus size={16} className="mr-2" /> Wähle Fotos aus den Models unten
            </div>
          )}

          {/* Model image picker */}
          {product.models.map(m => m.count > 0 && (
            <div key={m.model} className="mt-4">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">{m.label} ({m.count} Bilder)</div>
              <div className="flex flex-wrap gap-1.5">
                {m.images.map(img => {
                  const fp = `${product.folderPath}/${m.model}/${img}`;
                  const sel = form.photos.includes(fp);
                  return (
                    <button key={img} onClick={() => togglePhoto(fp)}
                      className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 transition ${sel ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200 hover:border-slate-300'}`}>
                      <img src={imgUrl(fp)} alt="" className="h-full w-full object-cover" />
                      {sel && <div className="absolute inset-0 flex items-center justify-center bg-brand-500/20"><CheckCircle2 size={16} className="text-white drop-shadow" /></div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Titel ──────────────────────────────────────────────────────── */}
        <div className="card divide-y divide-slate-100">
          <div className="flex items-center p-4">
            <span className="w-40 text-sm font-semibold text-slate-700">Titel</span>
            <div className="flex-1">
              <input type="text" value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="Teile Käufern mit, was du verkaufst" maxLength={150}
                className="w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
              <div className="mt-0.5 text-right text-[10px] text-slate-300">{form.title.length}/150</div>
            </div>
          </div>
          <div className="flex p-4">
            <span className="w-40 text-sm font-semibold text-slate-700">Beschreibung</span>
            <div className="flex-1">
              <textarea value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Erzähle Käufern mehr darüber" maxLength={2000} rows={4}
                className="w-full resize-y border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
              <div className="mt-0.5 text-right text-[10px] text-slate-300">{form.description.length}/2000</div>
            </div>
          </div>
        </div>

        {/* ── Kategorie / Marke / Größe / Zustand / Farbe / Material ──── */}
        <div className="card divide-y divide-slate-100">
          {/* Kategorie */}
          <Row label="Kategorie">
            <select value={form.category} onChange={e => set('category', e.target.value)} className="sel">
              <option value="">Wähle eine Kategorie</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.split(' > ').pop()}</option>)}
            </select>
          </Row>

          {/* Marke */}
          <Row label="Marke">
            <input type="text" value={form.brand} onChange={e => set('brand', e.target.value)}
              placeholder="Wähle eine Marke" className="w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
          </Row>

          {/* Größe */}
          <Row label="Größe">
            <select value={form.size} onChange={e => set('size', e.target.value)} className="sel">
              <option value="">Wähle eine Größe</option>
              {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Row>

          {/* Zustand */}
          <Row label="Zustand">
            <select value={form.condition} onChange={e => set('condition', e.target.value)} className="sel">
              <option value="">Wähle einen Zustand</option>
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </Row>
          {form.condition && (
            <div className="bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
              {CONDITIONS.find(c => c.value === form.condition)?.desc}
            </div>
          )}

          {/* Farbe */}
          <div className="p-4">
            <div className="flex items-start">
              <span className="w-40 pt-0.5 text-sm font-semibold text-slate-700">Farbe</span>
              <div className="flex-1">
                <div className="mb-1 text-xs text-slate-400">Wähle bis zu 2 Farben</div>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map(c => {
                    const sel = form.colors.includes(c);
                    return (
                      <button key={c} onClick={() => toggleColor(c)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          sel ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}>{c}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Material */}
          <Row label="Material (empfohlen)">
            <select value={form.material} onChange={e => set('material', e.target.value)} className="sel">
              <option value="">Wähle ein Material</option>
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Row>
        </div>

        {/* ── Preis ──────────────────────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-center p-4">
            <span className="w-40 text-sm font-semibold text-slate-700">Preis</span>
            <div className="flex items-center gap-1">
              <input type="number" step="0.01" min="0" value={form.price_eur || ''}
                onChange={e => set('price_eur', parseFloat(e.target.value) || 0)}
                placeholder="0,00" className="w-32 border-none bg-transparent text-right text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
              <span className="text-sm text-slate-500">€</span>
            </div>
          </div>
        </div>

        {/* ── Sendungsgröße ──────────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="mb-3 text-xs font-semibold text-slate-400">Bitte wähle eine Sendungsgröße aus</div>
          <div className="space-y-1">
            {SHIPPING.map(s => (
              <button key={s.value} onClick={() => set('shipping', s.value)}
                className={`flex w-full items-center rounded-xl p-3 text-left transition ${
                  form.shipping === s.value ? 'bg-brand-50 ring-2 ring-brand-500' : 'hover:bg-slate-50'
                }`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{s.value}</span>
                    {s.rec && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">Empfohlen</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{s.desc}</div>
                </div>
                <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  form.shipping === s.value ? 'border-brand-500 bg-brand-500' : 'border-slate-300'
                }`}>
                  {form.shipping === s.value && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">Für den Versand bezahlt immer der Käufer</div>
        </div>

        {/* ── Marktplätze ─────────────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">Marktplätze</span>
            <button
              onClick={() => { fetchMarketplaceHealth(); fetchMarketplaceStatus(); }}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              ↻ Aktualisieren
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { id: 'vinted',         label: 'Vinted' },
              { id: 'kleinanzeigen',  label: 'Kleinanzeigen' },
              { id: 'depop',          label: 'Depop' },
              { id: 'mercari',        label: 'Mercari' },
              { id: 'wallapop',       label: 'Wallapop' },
              { id: 'ebay_de',        label: 'eBay DE' },
              { id: 'ebay_uk',        label: 'eBay UK' },
              { id: 'etsy',           label: 'Etsy' },
              { id: 'grailed',        label: 'Grailed' },
              { id: 'fb_marketplace', label: 'FB Marketplace' },
            ].map(mp => {
              const online = mpHealth[mp.id];
              const live = mpStatus.find(s => s.marketplace === mp.id);
              const checked = selectedMarketplaces.includes(mp.id);
              return (
                <button
                  key={mp.id}
                  onClick={() => toggleMarketplace(mp.id)}
                  className={`relative rounded-lg border-2 p-3 text-left transition ${
                    checked ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800">{mp.label}</span>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        online === undefined ? 'bg-slate-300' : online ? 'bg-rose-500' : 'bg-red-500'
                      }`}
                      title={online === undefined ? 'unbekannt' : online ? 'Bot online' : 'Bot offline'}
                    />
                  </div>
                  {live && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      <span className={`font-bold ${live.status === 'active' ? 'text-rose-600' : live.status === 'sold' ? 'text-blue-600' : live.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>
                        {live.status}
                      </span>
                      {live.views > 0 && <span> · 👁 {live.views}</span>}
                      {live.likes > 0 && <span> · ❤ {live.likes}</span>}
                      {live.list_price_eur > 0 && <span> · €{live.list_price_eur.toFixed(2)}</span>}
                    </div>
                  )}
                  {live?.last_error && (
                    <div className="mt-1 truncate text-[10px] text-red-600" title={live.last_error}>{live.last_error}</div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              {selectedMarketplaces.length === 0
                ? 'Wähle Marktplätze aus'
                : `${selectedMarketplaces.length} Plattform(en) ausgewählt`}
            </div>
            <button
              onClick={pushMulti}
              disabled={pushing || selectedMarketplaces.length === 0 || !isComplete}
              className="btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:!bg-slate-300"
            >
              <CheckCircle2 size={14} /> {pushing ? 'Pushe...' : `Auf ${selectedMarketplaces.length || 0} Plattformen pushen`}
            </button>
          </div>
          {pushMsg && (
            <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-700">{pushMsg}</div>
          )}
        </div>

        {/* ── Save Bar ───────────────────────────────────────────────────── */}
        <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="text-sm text-slate-500">
            {!isComplete ? '⚠️ Fülle alle Pflichtfelder aus' : form.status === 'ready' ? '✅ Anzeige ist bereit zum Pushen' : '📝 Entwurf — noch nicht freigegeben'}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-secondary">
              <Save size={14} /> Speichern
            </button>
            {isComplete && form.status !== 'ready' && (
              <button onClick={markReady} className="btn-primary">
                <CheckCircle2 size={14} /> Fertigstellen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setLightbox(null)}>
          <img src={imgUrl(lightbox)} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" />
          <button onClick={() => setLightbox(null)} className="absolute right-4 top-4 rounded-full bg-white p-2 shadow"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center p-4">
      <span className="w-40 text-sm font-semibold text-slate-700">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
