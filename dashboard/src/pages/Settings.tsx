import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { AuthPanel } from '../components/AuthPanel';

export function SettingsPage() {
  const { settings, update, loading } = useSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraft({ ...settings });
  }, [settings]);

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  if (loading) return <div className="card">Lade…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>

      <AuthPanel />

      <div className="card space-y-4">
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
          <div className="mt-1 text-xs text-slate-500">
            Nicht bot-fähig: Apple Pay, Google Pay, Sofort bezahlen, Pay By Bank — die brauchen
            Touch-ID, Bank-Login oder SMS-Code. Der Bot pausiert automatisch, wenn 3DS / 2FA
            getriggert wird.
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
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Sicherheits-Hinweise</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
          <li>Captcha-Erkennung pausiert beide Bots automatisch.</li>
          <li>Der Temu-Bot bestellt nur mit bereits hinterlegter Zahlungsmethode — er tippt NIE Kartendaten ein.</li>
          <li>Jede Sale hat einen Idempotenz-Key: Doppelbestellungen sind ausgeschlossen.</li>
          <li>Listings im Dry-Run werden nur beobachtet — keine Auto-Accepts, keine Temu-Orders.</li>
        </ul>
      </div>
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
      <div>
        <div className="font-medium">{props.label}</div>
        {props.hint && <div className="text-xs text-slate-500">{props.hint}</div>}
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={props.value}
          onChange={(e) => props.onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-brand-600"></div>
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5"></div>
      </label>
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
      {props.hint && <div className="mt-1 text-xs text-slate-500">{props.hint}</div>}
    </div>
  );
}
