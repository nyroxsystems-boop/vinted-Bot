// ──────────────────────────────────────────────────────────────────────────────
// Operations Center
//
// One page to toggle EVERY background-worker + cross-cutting feature.
// Pure UI over the settings table — each toggle reads + writes a single
// settings-key. The worker loops pick up changes on their next tick (no
// restart needed for ~30s-1min cadence workers).
//
// Layout:
//   1. MASTER PAUSE (the big red button)
//   2. Pipeline (Discovery, Image-Gen, Variants, Publisher, Re-Lister)
//   3. Sales-Ops (Reply-Autopilot, Repricing, Sales-Killer, Wallet-Payout, Refund)
//   4. CJ Fulfillment (Auto-Order, Tracking-Sync, Webhook, Inventory)
//   5. Cross-Marketplaces (KA, eBay, Depop, Mercari, Wallapop, Etsy)
//   6. Monitoring (Health-Watcher, Account-Metrics, Conversion-Tracker, Trend-Scraper)
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { Power, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { toast } from '../components/Toast';

interface Settings {
  [key: string]: string;
}

interface ToggleSpec {
  key: string;
  label: string;
  hint?: string;
  /** "true"/"false" or custom on/off values (default "true"/"false") */
  on?: string;
  off?: string;
  /** Show as inverted (e.g. `paused`: true means OFF, false means ON) */
  invert?: boolean;
}

interface Section {
  title: string;
  subtitle?: string;
  toggles: ToggleSpec[];
}

const SECTIONS: Section[] = [
  {
    title: 'Pipeline',
    subtitle: 'Discovery → Bilder → Variants → Publish — der Geld-Generator-Pfad',
    toggles: [
      { key: 'cj_discovery_enabled', label: 'CJ-Discovery (Produkt-Suche)', hint: 'Sucht alle 30 min neue Top-Picks auf CJ' },
      { key: 'image_gen_realism_mode', label: 'AI-Photo Realism Mode', hint: 'Echtes CJ-Foto + Gemini-Background statt 100%-synthetic', on: 'realistic', off: 'copy_source' },
      { key: 'auto_listing_auto_approve', label: 'Auto-Approve Listings', hint: 'Überspringt manuelle Review — Variants → direkt Publish' },
      { key: 'relist_enabled', label: 'Re-Lister (24h nach Sale)', hint: 'Frische Re-Listings mit Photo-Shuffle + Title-Variation' },
    ],
  },
  {
    title: 'Sales-Operations',
    subtitle: 'Was nach dem Listing passiert',
    toggles: [
      { key: 'auto_reply_enabled', label: 'Reply-Autopilot (Käufer-Chats)', hint: 'LLM beantwortet Käufer-Fragen mit 10-15 min Delay' },
      { key: 'auto_repricing_enabled', label: 'Dynamic Pricing (Repricer)', hint: 'Auto-Drop bei Idle-Listings + Hot-Seller-Boost' },
      { key: 'sales_killer_enabled', label: 'Sales-Killer (Archiver)', hint: 'Archiviert tote Listings nach 14d + 2 Re-Lists ohne Sale' },
      { key: 'auto_fetch_shipping_label', label: 'Auto-Fetch Shipping-Labels', hint: 'Lädt Versandetiketten automatisch herunter' },
      { key: 'auto_send_tracking_to_buyer', label: 'Auto-Tracking an Käufer', hint: 'Sendet Tracking-Nummer per Vinted-Chat' },
      { key: 'auto_leave_feedback', label: 'Auto-Bewertung abgeben', hint: 'Bewertet Käufer automatisch nach Sale' },
    ],
  },
  {
    title: 'CJ Dropshipping',
    subtitle: 'Bestellungen + Inventar bei CJ',
    toggles: [
      { key: 'cj_auto_order', label: 'Auto-Bestellungen bei CJ', hint: 'Nach Sale automatisch CJ-Order auslösen (Achtung: Geld!)' },
      { key: 'cj_auto_tracking_sync', label: 'CJ Tracking-Sync', hint: 'Holt Tracking-Updates von CJ alle 6h' },
      { key: 'cj_webhook_enabled', label: 'CJ Webhook-Receiver', hint: 'Empfängt CJ-Push-Notifications' },
    ],
  },
  {
    title: 'Cross-Listing',
    subtitle: 'Auf welche Marktplätze auto-crosslistet wird',
    toggles: [
      { key: 'kleinanzeigen_enabled', label: 'Kleinanzeigen', hint: 'KA-Crosslist + Inbox-Polling' },
      { key: 'ebay_de_enabled', label: 'eBay Deutschland', hint: 'eBay-DE-OAuth-Listings' },
      { key: 'ka_sale_detect_enabled', label: 'KA Sale-Detection (LLM)', hint: 'LLM scanned KA-Chats nach Verkaufs-Signalen' },
    ],
  },
  {
    title: 'Monitoring & Health',
    subtitle: 'Was im Hintergrund beobachtet wird',
    toggles: [
      { key: 'account_health_auto_pause_enabled', label: 'Auto-Pause bei Bann-Signalen', hint: 'Pausiert Accounts bei 3+ CAPTCHAs / 5+ Rate-Limits — empfohlen für Production' },
      { key: 'vinted_warming_enabled', label: 'Account-Warming Curve', hint: 'Neue Accounts rampen Daily-Cap über 30 Tage hoch' },
      { key: 'db_backup_enabled', label: 'DB-Backup alle 6h', hint: 'Automatische SQLite-Backups in /data/backups/' },
      { key: 'telegram_enabled', label: 'Telegram-Alerts', hint: 'Health-Events + Sales an dein Telegram (braucht BOT_TOKEN + CHAT_ID)' },
    ],
  },
];

export default function OperationsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<Array<{ key: string; value: string }>>('/settings');
      const map: Settings = {};
      for (const r of d) map[r.key] = r.value;
      setSettings(map);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const writeSetting = async (key: string, value: string): Promise<void> => {
    setBusy(key);
    try {
      await api.patch('/settings', { key, value });
      setSettings((s) => ({ ...s, [key]: value }));
      toast.success(`${key} = ${value}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const isOn = (t: ToggleSpec): boolean => {
    const v = settings[t.key];
    const onVal = t.on ?? 'true';
    const raw = v === onVal;
    return t.invert ? !raw : raw;
  };

  const toggle = async (t: ToggleSpec): Promise<void> => {
    const current = isOn(t);
    const next = !current;
    const valToWrite = t.invert
      ? next ? (t.off ?? 'false') : (t.on ?? 'true')
      : next ? (t.on ?? 'true') : (t.off ?? 'false');
    await writeSetting(t.key, valToWrite);
  };

  const masterPaused = settings.paused === 'true';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        <Loader2 className="mr-2 animate-spin" size={18} /> Lädt…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Operations Center</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Schalter für alle Worker + Features. Klick → Worker stoppt/startet auf seinen nächsten Tick (max 1 min Verzögerung).
        </p>
      </div>

      {/* MASTER PAUSE — big red kill-switch */}
      <button
        onClick={() => void writeSetting('paused', masterPaused ? 'false' : 'true')}
        disabled={busy === 'paused'}
        className={`group flex w-full items-center justify-between rounded-2xl border p-6 text-left shadow-sm transition ${
          masterPaused
            ? 'border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/15'
            : 'border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/15'
        }`}
      >
        <div>
          <div className={`text-xs font-semibold uppercase tracking-wider ${masterPaused ? 'text-amber-300' : 'text-emerald-300'}`}>
            Master-Switch
          </div>
          <div className="mt-1 text-xl font-bold text-zinc-100">
            {masterPaused ? 'System pausiert — alle Worker schlafen' : 'System läuft — Worker arbeiten'}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {masterPaused
              ? 'Klick zum Starten. Pipeline + alle 33 Worker werden aktiv.'
              : 'Klick zum Pausieren. Alle Worker stoppen auf den nächsten Tick.'}
          </div>
        </div>
        <Power
          size={48}
          className={`shrink-0 transition ${
            masterPaused ? 'text-amber-400' : 'text-emerald-400 group-hover:scale-110'
          }`}
        />
      </button>

      {/* Sections */}
      {SECTIONS.map((section) => (
        <section key={section.title} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-zinc-100">{section.title}</h2>
            {section.subtitle && <p className="mt-0.5 text-xs text-zinc-500">{section.subtitle}</p>}
          </div>
          <div className="space-y-3">
            {section.toggles.map((t) => {
              const on = isOn(t);
              const isBusy = busy === t.key;
              return (
                <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-200">{t.label}</div>
                    {t.hint && <div className="mt-0.5 text-xs text-zinc-500">{t.hint}</div>}
                  </div>
                  <button
                    onClick={() => void toggle(t)}
                    disabled={isBusy}
                    className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
                      on
                        ? 'border-emerald-500/60 bg-emerald-500/30'
                        : 'border-zinc-700 bg-zinc-800'
                    } ${isBusy ? 'opacity-50' : ''}`}
                    aria-label={`Toggle ${t.label}`}
                  >
                    <span
                      className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white transition-all ${
                        on ? 'left-[22px] bg-emerald-300' : 'left-1 bg-zinc-400'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <strong className="text-zinc-300">Tipp:</strong> Worker-Loops checken ihre Settings auf jedem Tick.
        Änderung wirkt nach max 1 min (Auto-Publisher) bis 30 min (CJ-Discovery). Sofortiger
        Stopp via Master-Switch oben.
      </div>
    </div>
  );
}
