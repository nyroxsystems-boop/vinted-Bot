// ──────────────────────────────────────────────────────────────────────────────
// AssetUploader — per-folder image management for the new asset layout.
//
//   userAssetsRoot/products/{folder_num}/
//     source/    — user-supplied source photos (your own product shots)
//     product/   — AI-generated solo product on white
//     model/     — AI-generated model wearing the product
//     scene/     — AI-generated lifestyle / environment shots
//
// Drag-and-drop or file picker per kind. "Diese als Listing-Fotos setzen"
// pushes the selected kind(s) into auto_listings.photo_paths_json so the
// publisher uses them.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Trash2, CheckCircle2, X } from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';
import { photoUrl } from '../lib/photos';

type Kind = 'source' | 'product' | 'model' | 'scene' | 'final';

interface Shot {
  filename: string;
  path: string;
  size: number;
  mtime: string;
}

interface FolderShots {
  ok: boolean;
  folder_num: number;
  root: string;
  shots: Record<Kind, Shot[]>;
}

const KIND_META: Record<Kind, { label: string; hint: string; tint: string }> = {
  source:  { label: 'Source',     hint: 'Eigene Produkt-Fotos zum Upload',           tint: 'ring-zinc-700 bg-zinc-900/40' },
  product: { label: 'Solo-Shot',  hint: 'Produkt auf weiß (AI oder manuell)',         tint: 'ring-rose-500/30 bg-rose-500/5' },
  model:   { label: 'Model',      hint: 'Model trägt das Produkt (AI)',                tint: 'ring-rose-500/30 bg-rose-500/5' },
  scene:   { label: 'Umgebung',   hint: 'Lifestyle-Szene (Café, Outdoor, Bedroom …)',  tint: 'ring-rose-500/30 bg-rose-500/5' },
  final:   { label: 'Final',      hint: 'Kuratierte Auswahl — wird published',         tint: 'ring-amber-500/30 bg-amber-500/5' },
};

const KIND_ORDER: Kind[] = ['source', 'product', 'model', 'scene', 'final'];

async function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function AssetUploader() {
  const [folderNum, setFolderNum] = useState<number>(() => {
    const stored = Number(localStorage.getItem('br_studio_folder') ?? '1');
    return Number.isFinite(stored) && stored > 0 ? stored : 1;
  });
  const [data, setData] = useState<FolderShots | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<FolderShots>(`/assets/folder/${folderNum}`);
      setData(r);
    } catch (e) {
      toast.error('Konnte Ordner nicht laden', { detail: e instanceof Error ? e.message : String(e) });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [folderNum]);

  useEffect(() => {
    localStorage.setItem('br_studio_folder', String(folderNum));
    void load();
  }, [folderNum, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-zinc-100">Listing-Assets</h2>
          <p className="text-xs text-zinc-400">
            Eigene Fotos hochladen oder AI-Shots organisieren. Jeder Ordner gehört zu einem Listing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Folder</label>
          <input
            type="number"
            min={1}
            value={folderNum}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n > 0) setFolderNum(n);
            }}
            className="input w-24 tabular"
          />
        </div>
      </div>

      {data && (
        <div className="text-[11px] font-mono text-zinc-600 truncate">{data.root}</div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {KIND_ORDER.map((kind) => (
          <KindPanel
            key={kind}
            folderNum={folderNum}
            kind={kind}
            shots={data?.shots[kind] ?? []}
            onChanged={() => void load()}
            disabled={loading}
          />
        ))}
      </div>

      <UseAsListingPanel folderNum={folderNum} shots={data?.shots ?? null} onUsed={() => void load()} />
    </div>
  );
}

function KindPanel({
  folderNum, kind, shots, onChanged, disabled,
}: {
  folderNum: number;
  kind: Kind;
  shots: Shot[];
  onChanged: () => void;
  disabled: boolean;
}) {
  const meta = KIND_META[kind];
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    setBusy(true);
    try {
      const list = Array.from(files).filter((f) => /^image\/(jpeg|png|webp)$/i.test(f.type));
      if (list.length === 0) {
        toast.error('Nur JPG/PNG/WEBP erlaubt');
        return;
      }
      let ok = 0;
      for (const f of list) {
        try {
          const dataUrl = await readFileAsDataURL(f);
          await api.post('/assets/upload', {
            folder_num: folderNum,
            kind,
            filename: f.name,
            data_url: dataUrl,
          });
          ok++;
        } catch (e) {
          toast.error(`Upload fehlgeschlagen: ${f.name}`, { detail: e instanceof Error ? e.message : String(e) });
        }
      }
      if (ok > 0) toast.success(`${ok} Datei${ok === 1 ? '' : 'en'} hochgeladen`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [folderNum, kind, onChanged]);

  const remove = useCallback(async (filename: string) => {
    if (!confirm(`Datei "${filename}" löschen?`)) return;
    try {
      await api.del(`/assets/folder/${folderNum}/${kind}/${encodeURIComponent(filename)}`);
      onChanged();
    } catch (e) {
      toast.error('Löschen fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    }
  }, [folderNum, kind, onChanged]);

  return (
    <div className={`card ring-1 ${meta.tint} space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-zinc-100">{meta.label}</div>
          <div className="text-[11px] text-zinc-500">{meta.hint}</div>
        </div>
        <span className="rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 ring-1 ring-zinc-800">
          {shots.length}
        </span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          void uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-5 text-xs transition ${
          hover ? 'border-rose-500/60 bg-rose-500/5 text-rose-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
        } ${busy || disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <Upload size={18} />
        <span>{busy ? 'Lädt hoch…' : 'Klick oder Drop — JPG/PNG/WEBP, max 10 MB'}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {shots.length === 0 ? (
        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <ImageIcon size={12} />
          <span>Noch keine Dateien</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {shots.map((s) => (
            <div key={s.filename} className="group relative aspect-square overflow-hidden rounded-md bg-zinc-900 ring-1 ring-zinc-800">
              <img
                src={photoUrl(s.path)}
                alt={s.filename}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void remove(s.filename); }}
                className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 py-1 text-[10px] font-semibold text-rose-300 opacity-0 transition group-hover:opacity-100"
                title="Löschen"
              >
                <Trash2 size={11} /> löschen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UseAsListingPanel({
  folderNum, shots, onUsed,
}: {
  folderNum: number;
  shots: Record<Kind, Shot[]> | null;
  onUsed: () => void;
}) {
  const [selected, setSelected] = useState<Set<Kind>>(new Set(['final', 'model']));
  const [busy, setBusy] = useState(false);

  if (!shots) return null;
  const totalSelected = Array.from(selected).reduce((a, k) => a + shots[k].length, 0);

  async function apply() {
    if (totalSelected === 0) return;
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; photos: number; updated: boolean }>(
        `/assets/folder/${folderNum}/use`,
        { kinds: Array.from(selected) },
      );
      if (r.updated) {
        toast.success(`${r.photos} Fotos als Listing gesetzt`, { detail: `Folder #${folderNum}` });
        onUsed();
      } else {
        toast.error('Kein auto_listing für diesen Folder gefunden');
      }
    } catch (e) {
      toast.error('Konnte nicht setzen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-rose-500/20 bg-rose-500/[0.04]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-zinc-100">Als Listing-Fotos verwenden</div>
        <div className="text-xs text-zinc-400">
          Wähle die Kinds — Reihenfolge: final → model → scene → product → source.
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KIND_ORDER.map((k) => {
            const active = selected.has(k);
            const count = shots[k].length;
            return (
              <button
                key={k}
                type="button"
                disabled={count === 0}
                onClick={() => {
                  const next = new Set(selected);
                  if (active) next.delete(k);
                  else next.add(k);
                  setSelected(next);
                }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  active
                    ? 'bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/40'
                    : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {active && <CheckCircle2 size={11} />}
                {!active && count === 0 && <X size={11} />}
                {KIND_META[k].label}
                <span className="tabular text-zinc-500">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="btn-primary disabled:opacity-50"
        onClick={apply}
        disabled={busy || totalSelected === 0}
      >
        {busy ? '…' : `${totalSelected} Fotos setzen`}
      </button>
    </div>
  );
}
