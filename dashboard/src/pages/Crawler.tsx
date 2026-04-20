import { useState, useMemo } from 'react';
import {
  Search,
  Loader2,
  Package,
  Star,
  MessageCircle,
  Euro,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  usePresets,
  useCrawledProducts,
  runCrawl,
  type CrawlerFilters,
} from '../hooks/useCrawler';

export function CrawlerPage() {
  const { data: presetsBundle } = usePresets();
  const { products, loading, reload } = useCrawledProducts();

  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customQueries, setCustomQueries] = useState<string>('');
  const [filters, setFilters] = useState<CrawlerFilters>({
    min_rating: 4.2,
    min_reviews: 100,
    max_price_eur: 25,
    max_per_query: 100,
  });
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Seed filters from preset defaults when loaded
  useMemo(() => {
    if (presetsBundle?.default_filters) {
      setFilters((prev) => ({ ...prev, ...presetsBundle.default_filters }));
    }
  }, [presetsBundle]);

  const queriesFromSelection = (): { queries: string[]; presetName?: string } => {
    if (selectedPreset && presetsBundle) {
      const p = presetsBundle.presets.find((x) => x.name === selectedPreset);
      if (p) return { queries: p.queries, presetName: p.name };
    }
    const q = customQueries
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return { queries: q };
  };

  const handleRun = async () => {
    const { queries, presetName } = queriesFromSelection();
    if (queries.length === 0) {
      setLastResult('✗ Keine Suchbegriffe angegeben.');
      return;
    }
    setBusy(true);
    setLastResult(`⏳ Crawle ${queries.length} Query${queries.length > 1 ? 's' : ''}…`);
    try {
      const r = await runCrawl({ queries, filters, presetName });
      const totalKept = r.results.reduce((s, x) => s + x.kept, 0);
      const totalFound = r.results.reduce((s, x) => s + x.candidates, 0);
      setLastResult(
        `✓ ${totalKept} neue Produkte übernommen (von ${totalFound} gefunden) in ${queries.length} Query${queries.length > 1 ? 's' : ''}`,
      );
      await reload();
    } catch (e) {
      setLastResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Katalog · Temu-Crawler</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sucht Temu nach Produkten, filtert nach Bewertung/Preis, legt Ordner + Antigravity-Queue
          an. Alles läuft dann automatisch durch die Pipeline.
        </p>
      </div>

      {/* ── Crawl starten ──────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Neuer Crawl</h2>

        {/* Preset */}
        <div>
          <label className="label">Preset wählen (empfohlen)</label>
          <select
            className="input"
            value={selectedPreset}
            onChange={(e) => {
              setSelectedPreset(e.target.value);
              setCustomQueries('');
            }}
          >
            <option value="">— eigener Suchbegriff (unten) —</option>
            {presetsBundle?.presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label} ({p.queries.length} Queries)
              </option>
            ))}
          </select>
          {selectedPreset && presetsBundle && (
            <div className="mt-2 max-h-32 overflow-y-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
              {presetsBundle.presets
                .find((p) => p.name === selectedPreset)
                ?.queries.map((q, i) => (
                  <div key={i}>• {q}</div>
                ))}
            </div>
          )}
        </div>

        {/* Custom queries */}
        <div>
          <label className="label">Oder eigene Queries (eine pro Zeile)</label>
          <textarea
            className="input min-h-[100px] font-mono text-xs"
            placeholder="Damen Minikleid Weiß S&#10;Damen Blumenkleid Sommer"
            value={customQueries}
            onChange={(e) => {
              setCustomQueries(e.target.value);
              if (e.target.value.trim()) setSelectedPreset('');
            }}
            disabled={!!selectedPreset}
          />
        </div>

        {/* Filter */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FilterField
            label="Min Rating"
            icon={<Star size={12} />}
            value={filters.min_rating}
            step={0.1}
            max={5}
            onChange={(v) => setFilters({ ...filters, min_rating: v })}
          />
          <FilterField
            label="Min Reviews"
            icon={<MessageCircle size={12} />}
            value={filters.min_reviews}
            step={10}
            onChange={(v) => setFilters({ ...filters, min_reviews: v })}
          />
          <FilterField
            label="Max Preis €"
            icon={<Euro size={12} />}
            value={filters.max_price_eur}
            step={1}
            onChange={(v) => setFilters({ ...filters, max_price_eur: v })}
          />
          <FilterField
            label="Max pro Query"
            icon={<Package size={12} />}
            value={filters.max_per_query}
            step={1}
            onChange={(v) => setFilters({ ...filters, max_per_query: v })}
          />
        </div>

        {/* Action */}
        <div className="flex items-center justify-between gap-2">
          {lastResult && <div className="text-sm text-slate-600">{lastResult}</div>}
          <button className="btn-primary" disabled={busy} onClick={handleRun}>
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Crawling…
              </>
            ) : (
              <>
                <Search size={14} /> Crawl starten
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Gecrawlte Produkte ─────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">
            Gecrawlte Produkte{' '}
            <span className="ml-1 rounded-full bg-slate-200 px-2 text-xs text-slate-700">
              {products.length}
            </span>
          </h2>
          <button className="btn-secondary" onClick={() => void reload()}>
            Aktualisieren
          </button>
        </div>
        {loading && <div className="text-sm text-slate-400">Lade…</div>}
        {!loading && products.length === 0 && (
          <div className="rounded bg-slate-50 p-6 text-center text-sm text-slate-500">
            Noch keine gecrawlten Produkte. Starte einen Crawl oben.
          </div>
        )}
        {products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2">Titel</th>
                  <th>Preis</th>
                  <th>Rating</th>
                  <th>Reviews</th>
                  <th>Query</th>
                  <th>Ordner</th>
                  <th>Status</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 max-w-[220px] truncate" title={p.title ?? ''}>
                      {p.title}
                    </td>
                    <td>{p.price_eur != null ? `€${p.price_eur.toFixed(2)}` : '—'}</td>
                    <td>{p.rating != null ? p.rating.toFixed(1) : '—'}</td>
                    <td>{p.review_count ?? '—'}</td>
                    <td className="max-w-[160px] truncate text-xs text-slate-500">
                      {p.search_query}
                    </td>
                    <td className="font-mono text-xs">
                      {p.folder_num != null ? `#${p.folder_num}` : '—'}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <a
                        href={p.temu_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-brand-600 hover:underline"
                      >
                        Temu <ExternalLink size={10} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterField(props: {
  label: string;
  icon: JSX.Element;
  value: number;
  step: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="label flex items-center gap-1">
        {props.icon}
        {props.label}
      </div>
      <input
        type="number"
        className="input"
        step={props.step}
        min={0}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number.parseFloat(e.target.value))}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    crawled: 'bg-slate-100 text-slate-700',
    generating: 'bg-amber-100 text-amber-800',
    ready: 'bg-brand-100 text-brand-700',
    listed: 'bg-green-100 text-green-800',
    sold: 'bg-emerald-200 text-emerald-900',
    archived: 'bg-slate-200 text-slate-500',
  };
  const icon: Record<string, JSX.Element> = {
    ready: <CheckCircle2 size={10} />,
    listed: <CheckCircle2 size={10} />,
    sold: <CheckCircle2 size={10} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-[11px] font-medium ${
        cls[status] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {icon[status]}
      {status}
    </span>
  );
}
