import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../hooks/useSettings';
import { AuthPanel } from '../components/AuthPanel';
import { EbayAuthPanel } from '../components/EbayAuthPanel';
import { ShopifyAuthPanel } from '../components/ShopifyAuthPanel';
import { WoocommerceAuthPanel } from '../components/WoocommerceAuthPanel';
import { CaptchaPanel } from '../components/CaptchaPanel';
import { SellerPanel } from '../components/SellerPanel';
import { ReplyAutopilotPanel } from '../components/ReplyAutopilotPanel';
import { LicensePanel } from '../components/LicensePanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { UpdatesPanel } from '../components/UpdatesPanel';
import { getBrand } from '../lib/marketplace';

const SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'lizenz',      label: 'Lizenz' },
  { id: 'updates',     label: 'Updates' },
  { id: 'diagnose',    label: 'Diagnose' },
  { id: 'verkaeufer',  label: 'Verkäufer' },
  { id: 'autopilot',   label: 'Autopilot' },
  { id: 'logins',      label: 'Logins' },
  { id: 'api-auth',    label: 'API-Anbindungen' },
  { id: 'captcha',     label: 'CAPTCHA' },
  { id: 'system',      label: 'System' },
  { id: 'cj',          label: 'CJ Dropshipping' },
  { id: 'hilfe',       label: 'Hilfe' },
];

function SectionTabs({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <div className="sticky top-0 z-30 -mx-2 mb-3 border-b border-zinc-800/80 bg-[var(--surface-0)]/95 px-2 backdrop-blur-md">
      <div className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onSelect(s.id);
              // Persist last-active tab so reloads land on the same screen
              try { localStorage.setItem('br_settings_tab', s.id); } catch { /* ignore */ }
              // Scroll page to top on tab switch — each tab is its own view
              const scroller = document.querySelector('main') as HTMLElement | null;
              if (scroller) scroller.scrollTop = 0;
            }}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-semibold transition ${
              active === s.id
                ? 'bg-rose-500/15 text-rose-100 ring-1 ring-rose-500/30'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function useActiveTab(): [string, (id: string) => void] {
  // Restore the last-visited tab on mount; falls back to the first section.
  const [active, setActive] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('br_settings_tab');
      if (saved && SECTIONS.some((s) => s.id === saved)) return saved;
    } catch { /* ignore */ }
    return SECTIONS[0]!.id;
  });
  return [active, setActive];
}

export function SettingsPage() {
  const { settings, update, loading } = useSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [active, setActive] = useActiveTab();

  useEffect(() => {
    setDraft({ ...settings });
  }, [settings]);

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-48" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card space-y-3">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Einstellungen</h1>
        <p className="page-subtitle">Logins, Verkäufer-Profil, Auto-Crosslist, CAPTCHA-Strategie und Hilfe.</p>
      </div>

      <SectionTabs active={active} onSelect={setActive} />

      {active === 'lizenz' && <section><LicensePanel /></section>}
      {active === 'updates' && <section><UpdatesPanel /></section>}
      {active === 'diagnose' && <section><DiagnosticsPanel /></section>}

      {active === 'verkaeufer' && (
        <section>
          <SellerPanel draft={draft} set={set} onSave={() => void update(draft)} />
        </section>
      )}
      {active === 'autopilot' && (
        <section>
          <ReplyAutopilotPanel draft={draft} set={set} onSave={() => void update(draft)} />
        </section>
      )}

      {active === 'logins' && <section><AuthPanel /></section>}
      {active === 'api-auth' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">API-basierte Marketplaces</h2>
            <p className="mt-1 text-sm text-zinc-400">
              eBay, Shopify und WooCommerce nutzen API-Tokens statt Browser-Login. Einmal eintragen,
              danach läuft das Crosslisting komplett server-seitig.
            </p>
          </div>
          <EbayAuthPanel />
          <ShopifyAuthPanel />
          <WoocommerceAuthPanel />
        </section>
      )}
      {active === 'captcha' && <section><CaptchaPanel /></section>}

      {active === 'system' && <section className="card space-y-4">
        <Toggle
          label="System pausiert (Hard-Stop)"
          hint="Wenn aktiv, führt KEIN Bot Aktionen aus. Pending-Offers bleiben liegen."
          value={draft.paused === 'true'}
          onChange={(v) => set('paused', v ? 'true' : 'false')}
        />
        <NumberField
          label="Vinted Poll-Intervall (Sekunden)"
          hint="Mindestens 15 — niedrigere Werte erhöhen das Detection-Risiko."
          value={Number.parseInt(draft.vinted_poll_interval_s ?? '60', 10)}
          onChange={(v) => set('vinted_poll_interval_s', String(v))}
        />
        <NumberField
          label="Max. € pro Temu-Bestellung"
          hint="Bot bricht ab, wenn die Bestellsumme diesen Betrag übersteigt."
          value={Number.parseFloat(draft.temu_max_order_eur ?? '50')}
          step={1}
          onChange={(v) => set('temu_max_order_eur', String(v))}
        />
        <NumberField
          label="Max. Temu-Bestellungen pro 24h"
          hint="Runaway-Schutz. Bei Überschreiten werden neue Orders abgelehnt."
          value={Number.parseInt(draft.temu_max_daily_orders ?? '10', 10)}
          onChange={(v) => set('temu_max_daily_orders', String(v))}
        />

        <NumberField
          label="Standard-Batch-Fenster (Stunden)"
          hint="Wird auf der Fulfillment-Seite vorausgewählt. Typisch 24–72."
          value={Number.parseInt(draft.temu_batch_window_hours ?? '24', 10)}
          onChange={(v) => set('temu_batch_window_hours', String(v))}
        />

        <div>
          <div className="label">Temu-Zahlungsmethode</div>
          <select
            className="input max-w-[320px]"
            value={draft.temu_payment_method ?? 'paypal'}
            onChange={(e) => set('temu_payment_method', e.target.value)}
          >
            <option value="paypal">PayPal (empfohlen — einmal einloggen, Session bleibt)</option>
            <option value="bnpl30">Bezahlen Nach 30 Tagen (BNPL / Klarna)</option>
            <option value="rechnung">Rechnung (zahle 30 Tage später, zinsfrei)</option>
            <option value="karte">Karte (nur wenn kein 3DS getriggert wird)</option>
          </select>
          <div className="mt-1 text-xs text-zinc-400">
            Legacy-Einstellung für den Temu-Bot. Wird nur aktiv wenn Fulfillment-Provider auf "temu" steht.
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={() => void update(draft)}>
            Speichern
          </button>
          <button className="btn-secondary" onClick={() => setDraft({ ...settings })}>
            Zurücksetzen
          </button>
        </div>
      </section>}

      {active === 'cj' && <section className="card space-y-4">
        <h2 className="font-semibold">CJ Dropshipping</h2>
        <div>
          <div className="label">Fulfillment-Provider</div>
          <select
            className="input max-w-[320px]"
            value={draft.fulfillment_provider ?? 'cj'}
            onChange={(e) => set('fulfillment_provider', e.target.value)}
          >
            <option value="cj">CJ Dropshipping (API — empfohlen)</option>
            <option value="temu">Temu (Legacy — Browser-Bot)</option>
            <option value="manual">Manuell (kein Auto-Fulfillment)</option>
          </select>
          <div className="mt-1 text-xs text-zinc-400">
            CJ: Bestellung per API, CJ versendet direkt an Kunden. Temu: Playwright-Bot legt in Warenkorb.
          </div>
        </div>
        <Toggle
          label="CJ Auto-Bestellung"
          hint="Wenn aktiv, wird bei bezahlten Sales automatisch bei CJ bestellt."
          value={draft.cj_auto_order === 'true'}
          onChange={(v) => set('cj_auto_order', v ? 'true' : 'false')}
        />
        <NumberField
          label="Max. € pro CJ-Bestellung"
          hint="Sicherheitslimit pro Einzelbestellung."
          value={Number.parseFloat(draft.cj_max_order_eur ?? '30')}
          step={1}
          onChange={(v) => set('cj_max_order_eur', String(v))}
        />
        <NumberField
          label="Max. CJ-Bestellungen pro 24h"
          hint="Runaway-Schutz. Bei Überschreiten werden neue Orders abgelehnt."
          value={Number.parseInt(draft.cj_max_daily_orders ?? '50', 10)}
          onChange={(v) => set('cj_max_daily_orders', String(v))}
        />
        <div>
          <div className="label">Bevorzugtes Warehouse</div>
          <select
            className="input max-w-[320px]"
            value={draft.cj_preferred_warehouse ?? 'CN'}
            onChange={(e) => set('cj_preferred_warehouse', e.target.value)}
          >
            <option value="CN">China — günstigster Preis, 7–15 Tage</option>
            <option value="DE">Deutschland — 2–4 Tage, höherer Preis</option>
            <option value="US">USA — 3–5 Tage, für US-Marktplätze</option>
            <option value="UK">UK — 3–5 Tage, für Depop/eBay UK</option>
            <option value="NL">Niederlande — 3–5 Tage, EU-Lager</option>
          </select>
          <div className="mt-1 text-xs text-zinc-400">
            DE-Warehouse ideal für Vinted/Kleinanzeigen (schnelle Lieferung). US für Mercari/Grailed.
          </div>
        </div>
        <Toggle
          label="Auto Tracking-Sync"
          hint="Tracking-Nummer automatisch von CJ abholen und in die Sale eintragen."
          value={draft.cj_auto_tracking_sync === 'true'}
          onChange={(v) => set('cj_auto_tracking_sync', v ? 'true' : 'false')}
        />

        {/* ── Auto-Discovery (CJ-Pipeline) ─────────────────────────────── */}
        <div className="border-t border-zinc-800 pt-4">
          <Toggle
            label="CJ Auto-Discovery"
            hint="Sucht alle 30 min nach neuen Produkten bei CJ, importiert die mit höchstem Score automatisch. End-to-End: Discovery → Image-Gen → Variant-Gen → Auto-Publisher."
            value={draft.cj_discovery_enabled === 'true'}
            onChange={(v) => set('cj_discovery_enabled', v ? 'true' : 'false')}
          />
        </div>
        <div>
          <div className="label">Discovery Such-Begriffe (1 pro Zeile)</div>
          <textarea
            className="input min-h-[120px] font-mono text-xs"
            placeholder="women summer dress&#10;women crop top&#10;women high waist jeans"
            value={(() => {
              try {
                const arr = JSON.parse(draft.cj_discovery_queries ?? '[]') as string[];
                return arr.join('\n');
              } catch { return ''; }
            })()}
            onChange={(e) => set('cj_discovery_queries', JSON.stringify(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)))}
          />
          <div className="mt-1 text-xs text-zinc-500">
            Englisch funktioniert am besten auf CJ. Beispiele: <code>women boho dress</code>, <code>oversized hoodie</code>, <code>y2k mini skirt</code>.
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Min Kosten (€)"
            hint="Produkte unter diesem Preis werden ignoriert."
            value={Number.parseFloat(draft.cj_discovery_min_cost_eur ?? '4')}
            step={0.5}
            onChange={(v) => set('cj_discovery_min_cost_eur', String(v))}
          />
          <NumberField
            label="Max Kosten (€)"
            hint="Hard cap — zu teuer = zu wenig Marge."
            value={Number.parseFloat(draft.cj_discovery_max_cost_eur ?? '18')}
            step={0.5}
            onChange={(v) => set('cj_discovery_max_cost_eur', String(v))}
          />
          <NumberField
            label="Ziel-Marge (€)"
            hint="Bei Verkaufspreis vom Verkäufer-Profil — Score = Marge / Ziel."
            value={Number.parseFloat(draft.cj_discovery_target_margin ?? '12')}
            step={1}
            onChange={(v) => set('cj_discovery_target_margin', String(v))}
          />
        </div>
        <NumberField
          label="Max Importe pro Cycle"
          hint="Wie viele Top-Score-Produkte pro Run wirklich in die Pipeline gehen. Image-Gen kostet ~$0.20/Listing."
          value={Number.parseInt(draft.cj_discovery_max_per_cycle ?? '5', 10)}
          onChange={(v) => set('cj_discovery_max_per_cycle', String(v))}
        />

        {/* ── Image Generation Mode ──────────────────────────────────── */}
        <div className="border-t border-zinc-800 pt-4">
          <div className="label">Bild-Generation Modus</div>
          <select
            className="input max-w-[420px]"
            value={draft.image_gen_mode ?? 'copy_source'}
            onChange={(e) => set('image_gen_mode', e.target.value)}
          >
            <option value="copy_source">Stock-Bilder kopieren (0 € — schnell, weniger Conversion)</option>
            <option value="gemini">Gemini Lifestyle-Shots (~$0.20/Listing — Mirror-Selfie, Café, Outdoor, Studio)</option>
            <option value="antigravity">External Antigravity-Agent (Legacy)</option>
          </select>
          <div className="mt-1 text-xs text-zinc-500">
            Gemini braucht <code className="rounded bg-zinc-800 px-1 py-0.5">GEMINI_API_KEY</code> in <code>.env</code>.
            Free-Tier reicht für ~250 Bilder/Tag.
          </div>
        </div>

        {/* Auto-Crosslist Target Platforms */}
        <div>
          <div className="label">Auto-Crosslist Plattformen</div>
          <div className="mt-1 text-xs text-zinc-400 mb-2">
            Wenn ein Listing auf Vinted publiziert wird, automatisch auch auf diese Plattformen pushen.
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              'kleinanzeigen', 'depop', 'mercari', 'wallapop',
              'ebay_de', 'ebay_uk', 'etsy', 'grailed', 'fb_marketplace',
            ].map((mpId) => {
              const brand = getBrand(mpId);
              const Icon = brand.icon;
              const targets: string[] = (() => {
                try { return JSON.parse(draft.auto_crosslist_targets ?? '[]'); } catch { return []; }
              })();
              const active = targets.includes(mpId);
              return (
                <button
                  key={mpId}
                  type="button"
                  onClick={() => {
                    const next = active ? targets.filter((t) => t !== mpId) : [...targets, mpId];
                    set('auto_crosslist_targets', JSON.stringify(next));
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition select-none ${
                    active
                      ? `${brand.bgTint} ${brand.text} border-transparent ring-1 ${brand.ring}`
                      : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                  }`}
                >
                  <Icon size={11} strokeWidth={2.4} />
                  {brand.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={() => void update(draft)}>
            Speichern
          </button>
          <button className="btn-secondary" onClick={() => setDraft({ ...settings })}>
            Zurücksetzen
          </button>
        </div>
      </section>}

      {active === 'hilfe' && <section className="card space-y-3">
        <h2 className="font-semibold text-zinc-100">Hilfe &amp; Quickstart</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <HelpCard
            title="In 5 Minuten live"
            body={[
              '1. Vinted-Login (oben unter „Logins").',
              '2. CJ-API-Key eintragen — oder Fulfillment auf „manuell" stellen.',
              '3. Preise im Verkäufer-Profil setzen.',
              '4. Home → „Alles listen jetzt" klicken.',
            ]}
          />
          <HelpCard
            title="Sicherheits-Garantien"
            body={[
              'CJ-Bestellungen laufen über REST — kein Browser, kein Captcha.',
              'Idempotenz-Keys verhindern Doppelbestellungen.',
              'CJ versendet direkt an den Kunden — keine Handarbeit.',
              'Tracking wird automatisch zum Käufer gesendet.',
            ]}
          />
          <HelpCard
            title="CAPTCHA-Strategie"
            body={[
              'Standard: Whisper-Audio-Solve (lokal, 0 €).',
              'Fallback: Manual-Resume mit Banner.',
              'Optional: 2captcha mit API-Key.',
              'Pausen schützen die Session vor Detection.',
            ]}
          />
          <HelpCard
            title="Support"
            body={[
              'Mitglieder-Bereich: blackruby.app/members',
              'E-Mail: support@blackruby.app',
              'Auto-Update prüft täglich auf neue Versionen.',
              'Backup: Daten/SQLite unter data/.',
            ]}
          />
        </div>
      </section>}
    </div>
  );
}

function HelpCard({ title, body }: { title: string; body: string[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="kpi-label">{title}</div>
      <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
        {body.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-rose-400" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle(props: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-zinc-100">{props.label}</div>
        {props.hint && <div className="mt-0.5 text-xs text-zinc-400">{props.hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.value}
        data-on={props.value ? 'true' : 'false'}
        className="toggle"
        onClick={() => props.onChange(!props.value)}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

function NumberField(props: {
  label: string;
  hint?: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="label">{props.label}</div>
      <input
        type="number"
        step={props.step ?? 1}
        className="input max-w-[160px]"
        value={props.value}
        onChange={(e) => props.onChange(Number.parseFloat(e.target.value))}
      />
      {props.hint && <div className="mt-1 text-xs text-zinc-400">{props.hint}</div>}
    </div>
  );
}
