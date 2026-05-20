// ──────────────────────────────────────────────────────────────────────────────
// SceneStudio — pick the Vinted-style environments the image-generator uses.
//
// Mirrors ModelStudio but for the *setting* (bedroom mirror, café, outdoor,
// festival, etc.) rather than the *model*. Users can save multiple scene
// profiles and activate any subset — the generator rotates through the
// active ones so every listing has a different background.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  Image as ImageIcon, Sparkles, Save, Trash2, Check, Plus, Eye, Wand2, Lock, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import { toast } from '../components/Toast';

interface PickerOption { id: string; label: string; prompt: string; swatch?: string }

interface ScenePickers {
  setting: PickerOption[];
  mood: PickerOption[];
  time_of_day: PickerOption[];
  framing: PickerOption[];
  props: PickerOption[];
}

interface SceneAttributes {
  setting: string;
  mood: string;
  time_of_day: string;
  framing: string;
  props: string;
  freeform?: string;
}

interface SceneProfile {
  id: number;
  name: string;
  attributes: SceneAttributes;
  active: boolean;
  description: string;
  short: string;
  created_at: string;
  updated_at: string;
}

const SECTIONS: Array<{ key: keyof ScenePickers; label: string; hint: string }> = [
  { key: 'setting',     label: 'Umgebung',  hint: 'Wo wird das Foto aufgenommen?' },
  { key: 'mood',        label: 'Mood',      hint: 'Welche Stimmung soll rüberkommen?' },
  { key: 'time_of_day', label: 'Lichtzeit', hint: 'Tageszeit + Lichtquelle.' },
  { key: 'framing',     label: 'Ausschnitt',hint: 'Wie viel vom Model ist sichtbar?' },
  { key: 'props',       label: 'Props',     hint: 'Zusätzliche Accessoires.' },
];

export function SceneStudioPage() {
  const [pickers, setPickers] = useState<ScenePickers | null>(null);
  const [profiles, setProfiles] = useState<SceneProfile[]>([]);
  const [defaults, setDefaults] = useState<SceneAttributes | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SceneAttributes | null>(null);
  const [name, setName] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, profs] = await Promise.all([
        api.get<{ pickers: ScenePickers; defaults: SceneAttributes }>('/scene/pickers'),
        api.get<{ profiles: SceneProfile[] }>('/scene/profiles'),
      ]);
      setPickers(p.pickers);
      setDefaults(p.defaults);
      setProfiles(profs.profiles);
      if (currentId == null && !draft) {
        // No selection yet — show the first active profile, else defaults.
        const first = profs.profiles.find((x) => x.active) ?? profs.profiles[0];
        if (first) {
          setCurrentId(first.id);
          setDraft(first.attributes);
          setName(first.name);
        } else {
          setDraft(p.defaults);
          setName('Schlafzimmer-Spiegel');
        }
      }
    } catch (e) {
      toast.error('Konnte Pickers nicht laden', { detail: e instanceof Error ? e.message : String(e) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(key: keyof SceneAttributes, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  function selectProfile(p: SceneProfile) {
    setCurrentId(p.id);
    setDraft(p.attributes);
    setName(p.name);
    setPreviewUrl(null);
  }

  function newProfile() {
    if (!defaults) return;
    setCurrentId(null);
    setDraft(defaults);
    setName('Neue Szene');
    setPreviewUrl(null);
  }

  async function save(activate = false) {
    if (!draft || !name.trim()) {
      toast.warn('Name fehlt');
      return;
    }
    setBusy('save');
    try {
      if (currentId) {
        await api.put(`/scene/profiles/${currentId}`, { name: name.trim(), attributes: draft });
        if (activate) await api.post(`/scene/profiles/${currentId}/activate`);
        toast.success(activate ? 'Aktualisiert + aktiviert' : 'Aktualisiert');
      } else {
        const r = await api.post<{ profile: SceneProfile }>('/scene/profiles', {
          name: name.trim(), attributes: draft, activate,
        });
        setCurrentId(r.profile.id);
        toast.success(activate ? 'Erstellt + aktiviert' : 'Erstellt');
      }
      await load();
    } catch (e) {
      toast.error('Speichern fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(p: SceneProfile) {
    setBusy(`toggle-${p.id}`);
    try {
      if (p.active) await api.post(`/scene/profiles/${p.id}/deactivate`);
      else          await api.post(`/scene/profiles/${p.id}/activate`);
      await load();
    } catch (e) {
      toast.error('Toggle fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm('Szene wirklich löschen?')) return;
    setBusy(`del-${id}`);
    try {
      await api.del(`/scene/profiles/${id}`);
      toast.info('Szene gelöscht');
      if (currentId === id) {
        setCurrentId(null);
        if (defaults) setDraft(defaults);
      }
      await load();
    } catch (e) {
      toast.error('Fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!draft) return;
    setBusy('preview');
    setPreviewUrl(null);
    try {
      const r = await api.post<{ ok: boolean; dataUrl?: string; error?: string }>('/scene/preview', {
        attributes: draft,
      });
      if (r.ok && r.dataUrl) {
        setPreviewUrl(r.dataUrl);
      } else {
        toast.error('Preview fehlgeschlagen', { detail: r.error });
      }
    } catch (e) {
      toast.error('Preview fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!pickers || !draft) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  const activeCount = profiles.filter((p) => p.active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Szenen-Studio</h1>
          <p className="page-subtitle">
            Definiere die Umgebungen in denen dein Model fotografiert wird. Jeder Listing-Foto-Satz
            rotiert durch deine aktiven Szenen.
          </p>
        </div>
        <button onClick={newProfile} className="btn-secondary">
          <Plus size={14} /> Neue Szene
        </button>
      </div>

      {activeCount === 0 && (
        <div className="card flex items-start gap-2.5 border-amber-500/30 bg-amber-500/5 text-sm text-amber-200">
          <Wand2 size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">Keine Szene aktiv.</span>{' '}
            Der Image-Generator nutzt aktuell die Standard-Rotation (Schlafzimmer-Spiegel, Café, Outdoor, Studio).
            Aktiviere mindestens eine eigene Szene für konsistente Brand-Optik.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Editor */}
        <div className="card space-y-5">
          <div>
            <label className="label">Name dieser Szene</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Schlafzimmer-Spiegel, Café-Outfit, Festival-Look"
            />
          </div>

          {SECTIONS.map((s) => (
            <div key={s.key}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{s.label}</div>
                <span className="text-[10px] text-zinc-500">{s.hint}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {pickers[s.key].map((opt) => {
                  const active = draft[s.key] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => update(s.key, opt.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                        active
                          ? 'border-rose-500/50 bg-rose-500/10 text-rose-100 ring-1 ring-rose-500/30'
                          : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {opt.swatch && (
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded text-[13px]" aria-hidden>
                          {opt.swatch}
                        </span>
                      )}
                      <span className="truncate font-semibold">{opt.label}</span>
                      {active && <Check size={11} className="ml-auto shrink-0 text-rose-300" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <label className="label">Freitext (optional, advanced)</label>
            <input
              className="input font-mono text-xs"
              value={draft.freeform ?? ''}
              onChange={(e) => setDraft({ ...draft, freeform: e.target.value })}
              placeholder="zusätzliche Details, werden ans Prompt angehängt"
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
            <button onClick={() => void preview()} disabled={busy === 'preview'} className="btn-secondary text-sm">
              {busy === 'preview' ? <RefreshCw size={14} className="animate-spin" /> : <Eye size={14} />}
              {busy === 'preview' ? 'Generiere…' : 'Vorschau (~$0.04)'}
            </button>
            <button onClick={() => void save(false)} disabled={busy === 'save'} className="btn-ghost text-sm">
              <Save size={14} /> Speichern
            </button>
            <button onClick={() => void save(true)} disabled={busy === 'save'} className="btn-primary text-sm">
              <Lock size={14} /> Speichern + Aktivieren
            </button>
          </div>

          {previewUrl && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Vorschau</div>
              <img src={previewUrl} alt="Scene preview" className="w-full max-w-md rounded-lg" />
            </div>
          )}
        </div>

        {/* Profile-Liste */}
        <aside className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Gespeicherte Szenen ({profiles.length})
          </div>
          {profiles.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
              Noch keine Szenen. Stelle links eine ein und klick „Speichern".
            </div>
          )}
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`group rounded-lg border p-3 transition ${
                currentId === p.id ? 'border-rose-500/40 bg-rose-500/[0.06]' : 'border-zinc-800 bg-zinc-900/40'
              }`}
            >
              <button onClick={() => selectProfile(p)} className="block w-full text-left">
                <div className="flex items-center justify-between">
                  <div className="truncate text-sm font-semibold text-zinc-100">{p.name}</div>
                  {p.active && (
                    <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300 ring-1 ring-rose-500/30">
                      <Sparkles size={9} /> aktiv
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 truncate">{p.short}</div>
              </button>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => void toggleActive(p)}
                  disabled={busy === `toggle-${p.id}`}
                  className="flex-1 rounded border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  {p.active ? 'Deaktivieren' : 'Aktivieren'}
                </button>
                <button
                  onClick={() => void remove(p.id)}
                  disabled={busy === `del-${p.id}`}
                  className="rounded border border-zinc-700 p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300"
                  aria-label="Löschen"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </aside>
      </div>

      <div className="card flex items-start gap-2.5 text-xs text-zinc-400">
        <ImageIcon size={14} className="mt-0.5 shrink-0 text-zinc-500" />
        <div>
          <span className="font-semibold text-zinc-300">So funktioniert's:</span>{' '}
          Du speicherst mehrere Szenen und aktivierst die, die der Image-Generator nutzen soll.
          Bei {activeCount > 0 ? `${activeCount} aktiven` : '0 aktiven'} Szenen{activeCount > 0 ? ' rotiert' : ' fällt'} der
          Generator {activeCount > 0 ? 'durch sie' : 'auf die Standard-Rotation zurück'}.
          Kombiniert mit deinem aktiven Model-Profil ergibt das konsistente Brand-Fotos.
        </div>
      </div>
    </div>
  );
}
