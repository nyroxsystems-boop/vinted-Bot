// ──────────────────────────────────────────────────────────────────────────────
// ModelStudio — Sims-style character builder
//
// Visual pickers for every facet of the model. User picks, sees a live
// description preview, hits "Vorschau generieren" to spend ~$0.04 on one
// preview image. Once happy, "Speichern + Aktivieren" persists the profile
// and the image-generator uses it for every subsequent listing.
//
// Supports multiple saved profiles — switch the active one with one click.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  User, Sparkles, Save, Trash2, Check, Plus, Image as ImageIcon,
  RefreshCw, Camera, Lock, Wand2, Eye,
} from 'lucide-react';
import { api } from '../api/client';
import { toast } from '../components/Toast';
import { AssetUploader } from '../components/AssetUploader';

interface PickerOption {
  id: string;
  label: string;
  prompt: string;
  swatch?: string;
}

interface Pickers {
  ethnicity:  PickerOption[];
  skin_tone:  PickerOption[];
  hair_color: PickerOption[];
  hair_style: PickerOption[];
  eye_color:  PickerOption[];
  face_shape: PickerOption[];
  body_type:  PickerOption[];
  height:     PickerOption[];
  age_range:  PickerOption[];
  makeup:     PickerOption[];
  aesthetic:  PickerOption[];
}

interface ModelAttributes {
  ethnicity: string; skin_tone: string;
  hair_color: string; hair_style: string;
  eye_color: string; face_shape: string;
  body_type: string; height: string;
  age_range: string; makeup: string; aesthetic: string;
  freeform?: string;
}

interface Profile {
  id: number;
  name: string;
  attributes: ModelAttributes;
  has_reference: boolean;
  active: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

const SECTIONS: Array<{
  key: keyof Pickers;
  label: string;
  description: string;
  group: 'identity' | 'face' | 'body' | 'style';
}> = [
  { key: 'ethnicity',  label: 'Herkunft',         description: 'Look-Familie — beeinflusst Hautton/Features.', group: 'identity' },
  { key: 'age_range',  label: 'Alter',            description: 'Welche Altersgruppe spricht deine Zielgruppe an?', group: 'identity' },
  { key: 'skin_tone',  label: 'Hautton',          description: 'Sieben Stufen von Porzellan bis Ebenholz.', group: 'face' },
  { key: 'face_shape', label: 'Gesichtsform',     description: 'Oval ist Standard — Diamant für markant.', group: 'face' },
  { key: 'eye_color',  label: 'Augenfarbe',       description: '', group: 'face' },
  { key: 'hair_color', label: 'Haarfarbe',        description: '', group: 'face' },
  { key: 'hair_style', label: 'Haarstil',         description: 'Wavy + Long performt am besten auf Vinted.', group: 'face' },
  { key: 'body_type',  label: 'Körperbau',        description: 'Slim/Curvy/Athletic — gleicher Style, andere Conversion.', group: 'body' },
  { key: 'height',     label: 'Größe',            description: '', group: 'body' },
  { key: 'makeup',     label: 'Makeup',           description: 'Clean Girl = höchste CTR auf Gen-Z Plattformen.', group: 'style' },
  { key: 'aesthetic',  label: 'Aesthetic',        description: 'Übergreifender Vibe — färbt Pose & Atmosphäre.', group: 'style' },
];

const GROUPS = {
  identity: { label: 'Identität',  icon: User },
  face:     { label: 'Gesicht',    icon: Eye },
  body:     { label: 'Körper',     icon: Sparkles },
  style:    { label: 'Style',      icon: Wand2 },
};

export function ModelStudioPage() {
  const [pickers, setPickers] = useState<Pickers | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [defaults, setDefaults] = useState<ModelAttributes | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ModelAttributes | null>(null);
  const [name, setName] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<keyof typeof GROUPS>('identity');

  const load = useCallback(async () => {
    try {
      const [p, profs] = await Promise.all([
        api.get<{ pickers: Pickers; defaults: ModelAttributes }>('/model/pickers'),
        api.get<{ profiles: Profile[] }>('/model/profiles'),
      ]);
      setPickers(p.pickers);
      setDefaults(p.defaults);
      setProfiles(profs.profiles);

      // Pick active profile or default
      const active = profs.profiles.find((x) => x.active);
      if (active) {
        setCurrentId(active.id);
        setDraft(active.attributes);
        setName(active.name);
      } else if (!draft) {
        setDraft(p.defaults);
        setName('Mein Vinted-Model');
      }
    } catch (e) {
      console.error(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(key: keyof ModelAttributes, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  function selectProfile(p: Profile) {
    setCurrentId(p.id);
    setDraft(p.attributes);
    setName(p.name);
    setPreviewUrl(null);
  }

  function newProfile() {
    if (!defaults) return;
    setCurrentId(null);
    setDraft(defaults);
    setName('Neues Model');
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
        await api.put(`/model/profiles/${currentId}`, { name: name.trim(), attributes: draft });
        if (activate) await api.post(`/model/profiles/${currentId}/activate`);
        toast.success(activate ? 'Aktualisiert + aktiviert' : 'Aktualisiert');
      } else {
        const r = await api.post<{ profile: Profile }>('/model/profiles', { name: name.trim(), attributes: draft, activate });
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

  async function activate(id: number) {
    setBusy(`activate-${id}`);
    try {
      await api.post(`/model/profiles/${id}/activate`);
      toast.success('Aktiviert — neue Listings nutzen jetzt dieses Model');
      await load();
    } catch (e) {
      toast.error('Fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm('Profil wirklich löschen?')) return;
    setBusy(`del-${id}`);
    try {
      await api.del(`/model/profiles/${id}`);
      toast.info('Profil gelöscht');
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
      const r = await api.post<{ ok: boolean; dataUrl?: string; error?: string }>('/model/preview', { attributes: draft });
      if (r.ok && r.dataUrl) {
        setPreviewUrl(r.dataUrl);
        toast.success('Vorschau bereit');
      } else {
        toast.error('Preview fehlgeschlagen', { detail: r.error ?? 'Gemini API-Key prüfen' });
      }
    } catch (e) {
      toast.error('Preview-Request fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!pickers || !draft) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-9 w-64" />
        <div className="skeleton h-5 w-96" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-44 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const currentProfile = profiles.find((p) => p.id === currentId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Model Studio</h1>
          <p className="page-subtitle">
            Bau dein eigenes Vinted-Model wie in den Sims. Wird auf jedem generierten Lifestyle-Shot konsistent verwendet.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={newProfile} className="btn-ghost text-xs">
            <Plus size={13} /> Neues Profil
          </button>
        </div>
      </div>

      {/* Profile-Tabs */}
      {profiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProfile(p)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                currentId === p.id
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                  : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              {p.active && <Check size={11} className="text-rose-400" />}
              {p.name}
              {p.active && <span className="text-[9px] uppercase tracking-wider text-rose-300">aktiv</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Builder */}
        <div className="space-y-5">
          {/* Name + Save */}
          <div className="card flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Profil-Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Sommer-Lina"
                className="input"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void save(false)}
                disabled={busy === 'save'}
                className="btn-secondary text-xs"
              >
                <Save size={13} /> {busy === 'save' ? '…' : 'Speichern'}
              </button>
              <button
                onClick={() => void save(true)}
                disabled={busy === 'save'}
                className="btn-primary text-xs"
              >
                <Check size={13} /> Speichern + Aktivieren
              </button>
            </div>
          </div>

          {/* Group-Tabs */}
          <div className="flex gap-1 border-b border-zinc-800">
            {(Object.entries(GROUPS) as Array<[keyof typeof GROUPS, { label: string; icon: typeof User }]>).map(([key, info]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveGroup(key)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  activeGroup === key
                    ? 'border-rose-500 text-rose-300'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <info.icon size={14} />
                {info.label}
              </button>
            ))}
          </div>

          {/* Pickers */}
          <div className="space-y-5">
            {SECTIONS.filter((s) => s.group === activeGroup).map((section) => (
              <PickerSection
                key={section.key}
                title={section.label}
                description={section.description}
                options={pickers[section.key]}
                value={draft[section.key as keyof ModelAttributes] as string}
                onChange={(v) => update(section.key as keyof ModelAttributes, v)}
                pickerKey={section.key}
              />
            ))}
            {activeGroup === 'style' && (
              <div className="card">
                <label className="label">Frei-Text Verfeinerung (optional)</label>
                <textarea
                  rows={3}
                  className="input"
                  placeholder="z.B. 'silberne Halskette, kleine Tattoos am Handgelenk' — was die Picker nicht abdecken."
                  value={draft.freeform ?? ''}
                  onChange={(e) => setDraft({ ...draft, freeform: e.target.value })}
                />
                <div className="mt-1 text-xs text-zinc-500">
                  Wird ans Ende des Prompts gehängt. Bitte nur Englisch + kurz halten — sonst overridet das die Picker.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview Panel */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card-gradient">
            <div className="kpi-label flex items-center gap-1.5">
              <Lock size={11} /> Live-Vorschau
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              {previewUrl ? (
                <img src={previewUrl} alt="Model preview" className="aspect-[3/4] w-full object-cover" />
              ) : currentProfile?.has_reference ? (
                <img src={`/api/model/profiles/${currentProfile.id}/reference`} alt="Reference" className="aspect-[3/4] w-full object-cover" />
              ) : (
                <div className="grid aspect-[3/4] place-items-center text-zinc-600">
                  <div className="text-center">
                    <Camera size={32} className="mx-auto mb-2 opacity-50" />
                    <div className="text-xs">Vorschau generieren um Model zu sehen</div>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => void preview()}
              disabled={busy === 'preview'}
              className="btn-primary mt-3 w-full justify-center text-xs"
            >
              <Sparkles size={13} />
              {busy === 'preview' ? 'Generiere…' : previewUrl ? 'Neu generieren' : 'Vorschau generieren (~$0.04)'}
            </button>
            <p className="mt-2 text-[10px] text-zinc-500">
              Braucht <code>GEMINI_API_KEY</code> in <code>.env</code>. Free-Tier reicht für ~250 Bilder/Tag.
            </p>
          </div>

          <div className="card text-xs">
            <div className="label">Prompt-Vorschau</div>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
{buildLocalDescription(draft, pickers)}
            </pre>
          </div>

          {profiles.length > 1 && (
            <div className="card">
              <div className="label mb-2">Alle Profile</div>
              <div className="space-y-1.5">
                {profiles.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs">
                    {p.active ? (
                      <span className="dot-good dot-pulse" />
                    ) : (
                      <span className="dot-muted" />
                    )}
                    <span className="flex-1 truncate text-zinc-200">{p.name}</span>
                    {!p.active && (
                      <button
                        onClick={() => void activate(p.id)}
                        disabled={busy === `activate-${p.id}`}
                        className="text-[11px] text-rose-300 hover:underline"
                      >
                        aktivieren
                      </button>
                    )}
                    <button
                      onClick={() => void remove(p.id)}
                      disabled={busy === `del-${p.id}`}
                      className="text-zinc-500 hover:text-rose-300"
                      title="Löschen"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="mt-10 border-t border-zinc-800 pt-8">
        <AssetUploader />
      </div>
    </div>
  );
}

function PickerSection({
  title, description, options, value, onChange, pickerKey,
}: {
  title: string;
  description: string;
  options: PickerOption[];
  value: string;
  onChange: (v: string) => void;
  pickerKey: string;
}) {
  // Color-swatch grid for skin/hair/eye, full pill grid for everything else
  const isSwatchGrid = ['skin_tone', 'hair_color', 'eye_color'].includes(pickerKey);
  return (
    <div className="card">
      <div className="mb-3">
        <div className="font-semibold text-zinc-100">{title}</div>
        {description && <div className="mt-0.5 text-xs text-zinc-500">{description}</div>}
      </div>
      {isSwatchGrid ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-7">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={`group relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${
                value === o.id
                  ? 'border-rose-500/50 bg-rose-500/10 ring-2 ring-rose-500/30'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
              title={o.label}
            >
              <span
                className="block h-9 w-9 rounded-full border border-zinc-700 shadow-inner"
                style={{ background: o.swatch ?? '#999' }}
              />
              <span className="text-[10px] font-medium text-zinc-300">{o.label}</span>
              {value === o.id && (
                <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-white">
                  <Check size={9} />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={value === o.id ? 'pill-on' : 'pill-off'}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Mirrors shared/src/model-builder.ts buildModelDescription so the UI stays
// in sync without a roundtrip on every keystroke.
function buildLocalDescription(attrs: ModelAttributes, pickers: Pickers): string {
  const find = (opts: PickerOption[], id: string) => opts.find((o) => o.id === id)?.prompt ?? '';
  const parts: string[] = [];
  const age = find(pickers.age_range, attrs.age_range);
  const eth = find(pickers.ethnicity, attrs.ethnicity);
  parts.push(`A ${age} ${eth} woman`);
  const body = find(pickers.body_type, attrs.body_type);
  const height = find(pickers.height, attrs.height);
  if (body || height) parts.push(`with a ${[body, height].filter(Boolean).join(', ')}`);
  const skin = find(pickers.skin_tone, attrs.skin_tone);
  if (skin) parts.push(skin);
  const face = find(pickers.face_shape, attrs.face_shape);
  if (face) parts.push(`with an ${face}`);
  const eyes = find(pickers.eye_color, attrs.eye_color);
  if (eyes) parts.push(`and ${eyes}`);
  const hairColor = find(pickers.hair_color, attrs.hair_color);
  const hairStyle = find(pickers.hair_style, attrs.hair_style);
  if (hairColor && hairStyle) parts.push(`Hair: ${hairColor}, ${hairStyle}.`);
  const makeup = find(pickers.makeup, attrs.makeup);
  if (makeup) parts.push(`Makeup: ${makeup}.`);
  const aesthetic = find(pickers.aesthetic, attrs.aesthetic);
  if (aesthetic) parts.push(`Overall aesthetic: ${aesthetic}.`);
  if (attrs.freeform?.trim()) parts.push(attrs.freeform.trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
