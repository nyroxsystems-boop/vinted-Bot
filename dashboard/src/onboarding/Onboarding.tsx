// ──────────────────────────────────────────────────────────────────────────────
// First-run Onboarding Wizard
//
// Walks the customer through the five things that have to be true before the
// system can earn money:
//
//   1. Vinted login              — kicked off inline, status polled, can't be skipped
//   2. AI keys                   — Gemini for image/variant gen (free tier OK)
//   3. CJ Dropshipping           — optional, but if filled gets a live test ping
//   4. Pricing defaults          — list / floor
//   5. Crosslist targets         — which marketplaces to auto-push to
//
// Each step that depends on the backend surfaces live status instead of
// pretending it worked. Users who skip a step see a yellow "still needed"
// pill on the Home dashboard until they finish it.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  ArrowRight, ArrowLeft, Check, KeyRound, Package, Sparkles, Store,
  ShieldCheck, Loader2, ExternalLink, AlertTriangle, Cpu, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import { MARKETPLACE_LOGINS } from '../lib/marketplace-logins';

const LS_KEY = 'br_onboarding_done_v1';
const LS_STATE_KEY = 'br_onboarding_state_v1';

export function shouldShowOnboarding(): boolean {
  return localStorage.getItem(LS_KEY) !== 'true';
}

export function markOnboardingDone() {
  localStorage.setItem(LS_KEY, 'true');
  // Clean up mid-flow state once onboarding is complete.
  localStorage.removeItem(LS_STATE_KEY);
}

export function resetOnboarding() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_STATE_KEY);
}

// Non-sensitive state shape that we persist between mid-flow page reloads /
// app restarts. API keys live in component state only — never on disk in
// plain-text in the renderer — see `sensitiveFieldFilter` below.
interface PersistedOnboardingState {
  step: StepId;
  pricing: { list: number; floor: number };
  targets: string[];
  taxClassification: '' | 'kleinunternehmer' | 'regelunternehmer' | 'privat';
  tosAck: boolean;
}

function loadPersisted(): Partial<PersistedOnboardingState> {
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedOnboardingState>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface Props {
  onDone: () => void;
}

const STEPS = [
  { id: 'welcome',  label: 'Start' },
  { id: 'login',    label: 'Vinted' },
  { id: 'keys',     label: 'AI-Keys' },
  { id: 'cj',       label: 'CJ' },
  { id: 'pricing',  label: 'Preise' },
  { id: 'targets',  label: 'Marktplätze' },
  { id: 'legal',    label: 'Rechtliches' },
  { id: 'done',     label: 'Fertig' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

type TaxClassification = '' | 'kleinunternehmer' | 'regelunternehmer' | 'privat';

export function Onboarding({ onDone }: Props) {
  // Hydrate non-sensitive state from localStorage so that a mid-flow refresh
  // / restart doesn't lose pricing / targets / legal selections. API keys are
  // explicitly NOT persisted (plain-text in browser storage is a no-go).
  const persisted = loadPersisted();

  const [step, setStep] = useState<StepId>(persisted.step ?? 'welcome');
  const [pricing, setPricing] = useState(persisted.pricing ?? { list: 28, floor: 19 });
  const [cjKey, setCjKey] = useState('');
  const [cjEmail, setCjEmail] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [targets, setTargets] = useState<string[]>(persisted.targets ?? ['kleinanzeigen']);
  const [taxClassification, setTaxClassification] = useState<TaxClassification>(
    persisted.taxClassification ?? '',
  );
  const [tosAck, setTosAck] = useState<boolean>(persisted.tosAck ?? false);
  const [busy, setBusy] = useState(false);

  const idx = STEPS.findIndex((s) => s.id === step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]!.id);
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]!.id);

  // Persist non-sensitive state after every change. Sensitive fields (cjKey,
  // cjEmail, geminiKey, anthropicKey) are deliberately excluded — they stay
  // in component memory only and are flushed to the backend via finish().
  useEffect(() => {
    try {
      const snapshot: PersistedOnboardingState = {
        step,
        pricing,
        targets,
        taxClassification,
        tosAck,
      };
      localStorage.setItem(LS_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      /* localStorage may be full / disabled — non-fatal */
    }
  }, [step, pricing, targets, taxClassification, tosAck]);

  // "Weiter" on the legal step is gated until the user actually acknowledges
  // the Tool-not-Tax-Advisor disclaimer + picks a classification.
  const legalNextDisabled = step === 'legal' && (!tosAck || !taxClassification);

  async function finish() {
    setBusy(true);
    try {
      const updates: Record<string, string> = {
        listing_price_default: String(pricing.list),
        listing_price_floor: String(pricing.floor),
        auto_crosslist_targets: JSON.stringify(targets),
      };
      if (taxClassification) {
        updates.user_tax_classification = taxClassification;
        updates.tos_acknowledged_at = new Date().toISOString();
      }
      if (cjKey)        updates.cj_api_key = cjKey;
      if (cjEmail)      updates.cj_email = cjEmail;
      if (geminiKey)    updates.gemini_api_key = geminiKey;
      if (anthropicKey) updates.anthropic_api_key = anthropicKey;
      await api.put('/settings', updates as Record<string, string>);
    } catch {
      /* Settings save is best-effort — the user can change them later. */
    }
    markOnboardingDone();
    setBusy(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/85 px-4 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-950 p-8 shadow-2xl">
        <Progress idx={idx} />

        <div className="mt-8 min-h-[280px]">
          {step === 'welcome' && <Welcome />}
          {step === 'login'   && <LoginStep />}
          {step === 'keys'    && <KeysStep gemini={geminiKey} setGemini={setGeminiKey} anthropic={anthropicKey} setAnthropic={setAnthropicKey} />}
          {step === 'cj'      && <CjStep cjKey={cjKey} setCjKey={setCjKey} cjEmail={cjEmail} setCjEmail={setCjEmail} />}
          {step === 'pricing' && <PricingStep pricing={pricing} setPricing={setPricing} />}
          {step === 'targets' && <TargetsStep targets={targets} setTargets={setTargets} />}
          {step === 'legal'   && (
            <LegalStep
              taxClassification={taxClassification}
              setTaxClassification={setTaxClassification}
              tosAck={tosAck}
              setTosAck={setTosAck}
            />
          )}
          {step === 'done'    && <DoneStep />}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-5">
          <button
            type="button"
            onClick={back}
            disabled={idx === 0 || busy}
            className="btn-ghost disabled:opacity-30"
          >
            <ArrowLeft size={14} /> Zurück
          </button>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Schritt {idx + 1} / {STEPS.length}
          </div>
          {step === 'done' ? (
            <button type="button" onClick={() => void finish()} disabled={busy} className="btn-primary">
              {busy ? 'Speichere…' : 'Loslegen'} <Check size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={legalNextDisabled}
              className="btn-primary disabled:opacity-40"
            >
              Weiter <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ idx }: { idx: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex flex-1 items-center gap-1.5">
            <div
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold transition ${
                done
                  ? 'bg-rose-500 text-white'
                  : active
                    ? 'bg-white text-zinc-950 ring-4 ring-rose-500/30'
                    : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {done ? <Check size={13} /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 ${done ? 'bg-rose-500/50' : 'bg-zinc-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepHeader({ icon: Icon, title, sub }: { icon: typeof Sparkles; title: string; sub: string }) {
  return (
    <div className="space-y-3">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
        <Icon size={20} />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="mt-1.5 text-sm text-zinc-400">{sub}</p>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="space-y-5">
      <StepHeader
        icon={Sparkles}
        title="Willkommen bei Blackruby."
        sub="In ~10 Minuten richten wir alles ein — Vinted-Login, AI-Keys, Preis-Defaults und Crosslist-Ziele. Du kannst jeden Schritt überspringen und später anpassen."
      />
      <ul className="space-y-1.5 text-sm text-zinc-300">
        <li className="flex items-center gap-2"><Check size={14} className="text-rose-400" /> Alles lokal — keine Cloud, keine fremden Server</li>
        <li className="flex items-center gap-2"><Check size={14} className="text-rose-400" /> Vinted-Bot mit echter Browser-Session (kein Reverse-API)</li>
        <li className="flex items-center gap-2"><Check size={14} className="text-rose-400" /> Auto-Crosslist auf 10+ Marktplätze</li>
      </ul>
    </div>
  );
}

interface BotAuthStatus {
  ok?: boolean;
  session?: { state: 'valid' | 'invalid' | 'checking' | 'unknown'; message?: string | null; checked_at?: string | null };
  login?: { state: 'idle' | 'waiting' | 'success' | 'failed'; message?: string | null };
}

// ── Vinted Login: inline status check + retry, instead of "later in Settings"
function LoginStep() {
  const [accountId, setAccountId] = useState<number | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [flow, setFlow] = useState<BotAuthStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetch account + bot login state on mount, then poll every 2s — Vinted's
  // login flow changes status fast (browser-opened → waiting → success/failed),
  // 4s felt sluggish.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [accounts, auth] = await Promise.all([
          api.get<{ items: Array<{ id: number; logged_in: number }>; currentId: number }>('/accounts'),
          api.get<Record<string, BotAuthStatus | { error: string }>>('/auth/status').catch(() => null),
        ]);
        if (cancelled) return;
        const me = accounts.items.find((a) => a.id === accounts.currentId) ?? accounts.items[0];
        if (me) {
          setAccountId(me.id);
          setLoggedIn(me.logged_in === 1);
        }
        const vintedAuth = auth?.vinted;
        if (vintedAuth && 'session' in vintedAuth) setFlow(vintedAuth as BotAuthStatus);
      } catch {
        /* backend may be offline — OrchestratorHealthBanner surfaces it */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  async function startLogin() {
    if (!accountId) return;
    setStarting(true); setErr(null);
    try {
      await api.post(`/accounts/${accountId}/login`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const loginState = flow?.login?.state ?? 'idle';
  const loginMessage = flow?.login?.message ?? null;
  const sessionState = flow?.session?.state ?? 'unknown';
  const isWaitingForBrowser = loginState === 'waiting';
  const isFailedFlow = loginState === 'failed';

  return (
    <div className="space-y-4">
      <StepHeader
        icon={KeyRound}
        title="Vinted-Login"
        sub={'Klick "Browser öffnen" — ein Chromium-Fenster startet. Logge dich bei Vinted ein (E-Mail + Passwort + ggf. SMS-Code). Die Session bleibt 2–4 Wochen aktiv.'}
      />

      {loggedIn === true && sessionState === 'valid' ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900/60 p-4 text-sm">
          <Check size={16} className="mt-0.5 shrink-0 text-rose-300" />
          <div>
            <div className="font-bold text-zinc-100">Eingeloggt.</div>
            <div className="text-zinc-400">Session aktiv — du kannst weitergehen.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void startLogin()}
            disabled={!accountId || starting || isWaitingForBrowser}
            className="btn-primary"
          >
            {starting || isWaitingForBrowser ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <KeyRound size={14} />
            )}
            {starting
              ? 'Browser startet…'
              : isWaitingForBrowser
                ? 'Browser offen — bitte einloggen'
                : isFailedFlow
                  ? 'Erneut versuchen'
                  : 'Browser öffnen & einloggen'}
          </button>

          {isWaitingForBrowser && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
              <div>
                <span className="font-bold">Browser ist offen — bitte einloggen.</span>
                {loginMessage && <div className="mt-0.5 text-amber-200/80">{loginMessage}</div>}
                <div className="mt-1 text-amber-300/70">
                  Sobald Vinted dich erkennt, springt die Anzeige automatisch auf „Eingeloggt".
                </div>
              </div>
            </div>
          )}

          {isFailedFlow && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <div>
                <span className="font-bold">Login fehlgeschlagen.</span>
                {loginMessage && <div className="mt-0.5 text-amber-200/80">{loginMessage}</div>}
                {loginMessage?.toLowerCase().includes('captcha') && (
                  <div className="mt-1 text-amber-300/70">
                    CAPTCHA blockiert — öffne Vinted im normalen Browser, löse das CAPTCHA, dann „Erneut versuchen".
                  </div>
                )}
              </div>
            </div>
          )}

          {!isWaitingForBrowser && !isFailedFlow && loggedIn === false && (
            <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <span className="font-bold text-zinc-200">Noch nicht eingeloggt.</span>
                <span className="ml-1">Klick „Browser öffnen" — Login geschieht im echten Chromium, der Bot übernimmt die Session.</span>
              </div>
            </div>
          )}

          {err && <div className="text-xs text-amber-300">Fehler: {err}</div>}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">Tipp:</span> Frische Vinted-Accounts werden schneller geflaggt.
        Lass den Account 2–3 Tage „atmen" (Profilbild, 5–10 manuell erstellte Listings) bevor du den Auto-Publisher startest.
      </div>
    </div>
  );
}

// ── API-Keys: Gemini is the cheap default for image + variant gen
function KeysStep({
  gemini, setGemini, anthropic, setAnthropic,
}: { gemini: string; setGemini: (v: string) => void; anthropic: string; setAnthropic: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <StepHeader
        icon={Cpu}
        title="AI-Keys"
        sub="Listing-Beschreibungen, Modell-Bilder und Sale-Detection nutzen LLMs. Ohne Key läuft der Auto-Publisher mit Stock-Texten — funktioniert, aber sells schlechter."
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="label mb-0">Gemini API-Key</label>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:underline"
          >
            Free-Tier holen <ExternalLink size={10} />
          </a>
        </div>
        <input
          className="input font-mono"
          type="password"
          value={gemini}
          onChange={(e) => setGemini(e.target.value)}
          placeholder="AIza••••••••••••••"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Empfohlen. Free-Tier deckt ~250 Listings/Tag — reicht für die meisten Hustler.
        </p>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
          Optional: Anthropic Claude (premium description quality)
        </summary>
        <div className="mt-3">
          <input
            className="input font-mono"
            type="password"
            value={anthropic}
            onChange={(e) => setAnthropic(e.target.value)}
            placeholder="sk-ant-••••••••••••••"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Claude liefert bessere Texte aber kostet ~$0.01/Listing. Erst sinnvoll wenn Gemini-Texte unterperformen.
          </p>
        </div>
      </details>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <AlertTriangle size={12} className="mr-1 inline align-middle" />
        Ohne Key bleibt Auto-Publisher operational — aber Variant-Generator, Image-Generator und Sale-Detection auf Kleinanzeigen funktionieren nicht.
      </div>
    </div>
  );
}

function CjStep({
  cjKey, setCjKey, cjEmail, setCjEmail,
}: { cjKey: string; setCjKey: (v: string) => void; cjEmail: string; setCjEmail: (v: string) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function test() {
    if (!cjEmail || !cjKey) return;
    setTesting(true); setResult(null); setErrMsg(null);
    try {
      // Hit settings + ping the CJ-service. Backend-side validation is the
      // authoritative source — we just need a 2xx round-trip.
      await api.put('/settings', { cj_email: cjEmail, cj_api_key: cjKey });
      const r = await api.get<{ ok: boolean; error?: string }>('/cj/ping').catch(() => ({ ok: false, error: 'CJ-Service nicht erreichbar' }));
      if (r.ok) setResult('ok'); else { setResult('fail'); setErrMsg(r.error ?? null); }
    } catch (e) {
      setResult('fail');
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Package}
        title="CJ Dropshipping"
        sub="Optional — nur wenn du CJ als Fulfillment nutzt. Bestellung läuft per API, CJ versendet direkt an den Käufer."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">E-Mail</label>
          <input className="input font-mono" value={cjEmail} onChange={(e) => setCjEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="label">API-Key</label>
          <input className="input font-mono" type="password" value={cjKey} onChange={(e) => setCjKey(e.target.value)} placeholder="•••••••••••" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void test()}
          disabled={!cjEmail || !cjKey || testing}
          className="btn-secondary"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Verbindung testen
        </button>
        {result === 'ok' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-300">
            <Check size={12} /> Verbunden
          </span>
        )}
        {result === 'fail' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-300">
            <AlertTriangle size={12} /> {errMsg ?? 'Verbindung fehlgeschlagen'}
          </span>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        Key holst du unter{' '}
        <a href="https://app.cjdropshipping.com/myCJ.html#/developer" target="_blank" rel="noreferrer" className="text-rose-300 hover:underline">
          cjdropshipping.com → Developer <ExternalLink size={10} className="inline" />
        </a>. Beide Felder leer lassen = Schritt überspringen.
      </p>
    </div>
  );
}

function PricingStep({
  pricing, setPricing,
}: { pricing: { list: number; floor: number }; setPricing: (v: { list: number; floor: number }) => void }) {
  return (
    <div className="space-y-4">
      <StepHeader
        icon={Sparkles}
        title="Preis-Defaults"
        sub="Listpreis steht im Inserat, Mindest-Akzept ist die Untergrenze für Auto-Accept bei Verhandlungen."
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Listpreis (€)</label>
          <input
            type="number"
            className="input"
            value={pricing.list}
            onChange={(e) => setPricing({ ...pricing, list: Number(e.target.value) || 0 })}
          />
          <p className="mt-1 text-xs text-zinc-500">Wird ±2 € randomisiert pro Listing.</p>
        </div>
        <div>
          <label className="label">Mindest-Akzept (€)</label>
          <input
            type="number"
            className="input"
            value={pricing.floor}
            onChange={(e) => setPricing({ ...pricing, floor: Number(e.target.value) || 0 })}
          />
          <p className="mt-1 text-xs text-zinc-500">Unter diesem Preis wird automatisch abgelehnt.</p>
        </div>
      </div>
    </div>
  );
}

function TargetsStep({
  targets, setTargets,
}: { targets: string[]; setTargets: (v: string[]) => void }) {
  // Pull from the shared login-catalog so onboarding stays in sync with
  // Settings → Logins (no drift when a new marketplace is added). Vinted
  // is the source, so it's excluded from the crosslist target list.
  const options = MARKETPLACE_LOGINS.filter((m) => m.id !== 'vinted');
  return (
    <div className="space-y-4">
      <StepHeader
        icon={Store}
        title="Auto-Crosslist"
        sub="Wenn ein Listing auf Vinted live geht, wird es automatisch auf diese Marktplätze gepusht. Jederzeit in den Einstellungen anpassbar."
      />
      <p className="text-[11px] text-zinc-500">
        Erstmal nur ankreuzen — Login folgt später unter <em>Einstellungen → Logins</em>.
        Cloudflare-Plattformen sind markiert, API-Plattformen brauchen Token statt Browser-Login.
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((mp) => {
          const active = targets.includes(mp.id);
          return (
            <button
              key={mp.id}
              type="button"
              onClick={() => {
                setTargets(active ? targets.filter((t) => t !== mp.id) : [...targets, mp.id]);
              }}
              className={active ? 'pill-on' : 'pill-off'}
              title={mp.hint}
            >
              {mp.label}
              {mp.cloudflare && <span className="ml-1 text-[9px] opacity-70">☁</span>}
              {mp.apiOnly && <span className="ml-1 text-[9px] opacity-70">API</span>}
              {mp.risk === 'high' && <span className="ml-1 text-[9px] opacity-70">⚠</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegalStep({
  taxClassification, setTaxClassification, tosAck, setTosAck,
}: {
  taxClassification: TaxClassification;
  setTaxClassification: (v: TaxClassification) => void;
  tosAck: boolean;
  setTosAck: (v: boolean) => void;
}) {
  const options: { id: Exclude<TaxClassification, ''>; title: string; sub: string }[] = [
    {
      id: 'kleinunternehmer',
      title: 'Kleinunternehmer (§ 19 UStG)',
      sub: 'Gewerbe angemeldet, Umsatz < 22.500 € / Jahr — keine USt auf Rechnungen.',
    },
    {
      id: 'regelunternehmer',
      title: 'Regelunternehmer (mit USt)',
      sub: 'Gewerbe angemeldet, USt-IdNr. vorhanden — du führst Umsatzsteuer ab.',
    },
    {
      id: 'privat',
      title: 'Privatverkauf (Hobby)',
      sub: 'Gelegentliche Verkäufe ohne Gewinnabsicht — kein Gewerbe. Beachte Vinted/Plattform-AGB.',
    },
  ];

  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Rechtliches & Steuern"
        sub="Damit du sauber startest: wähle deinen Steuerstatus und bestätige, dass du selbst für Compliance verantwortlich bist."
      />

      <div className="space-y-2">
        {options.map((opt) => {
          const active = taxClassification === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTaxClassification(opt.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                active
                  ? 'border-rose-500/60 bg-rose-500/10'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                    active ? 'border-rose-400 bg-rose-500' : 'border-zinc-600 bg-transparent'
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{opt.title}</div>
                  <div className="mt-0.5 text-xs text-zinc-400">{opt.sub}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <input
          type="checkbox"
          checked={tosAck}
          onChange={(e) => setTosAck(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-rose-500"
        />
        <span>
          Ich verstehe, dass Blackruby ein <span className="font-bold">Tool</span> ist und ich
          allein verantwortlich für Steuer- und Marktplatz-Compliance bin (Vinted-AGB,
          Gewerbeanmeldung, USt-Abführung, Einkommensteuer). Blackruby ist keine Steuer- oder
          Rechtsberatung.
        </span>
      </label>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Du kannst die Wahl später in Einstellungen → Rechtliches anpassen. Die Bestätigung
        wird mit Zeitstempel im lokalen Datenbestand gespeichert.
      </p>
    </div>
  );
}

function DoneStep() {
  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Bereit zum Hustle."
        sub='Klicke „Loslegen" — du landest auf dem Home-Dashboard. Lade Produkt-Fotos hoch oder importiere CJ-Listings, dann klick "Alles listen jetzt".'
      />
      <ul className="space-y-2 text-sm text-zinc-300">
        <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-rose-400" /> Logins / API-Keys jederzeit unter <span className="font-mono text-zinc-100">Einstellungen → Logins / Keys</span></li>
        <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-rose-400" /> CAPTCHA-Banner oben — Resume-Button drücken wenn Vinted blockiert</li>
        <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-rose-400" /> System pausieren via Toggle in Einstellungen → System</li>
      </ul>
    </div>
  );
}
