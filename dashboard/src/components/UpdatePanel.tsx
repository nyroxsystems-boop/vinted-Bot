// ──────────────────────────────────────────────────────────────────────────────
// System-Update Panel
//
// A single "Jetzt aktualisieren"-button that:
//   • Detects what changed locally (TS in bot/orchestrator vs. Rust/Dashboard).
//   • Picks the right path: fast service-restart OR full 2–3 min rebuild.
//   • Streams progress into an inline status bar.
//
// Only active in the Tauri shell — in a plain browser it shows a friendly
// banner explaining why the button is disabled.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileClock,
  Hammer,
  Loader2,
  RefreshCw,
  RotateCw,
  Zap,
} from 'lucide-react';
import {
  isTauri,
  listen,
  tauri,
  type ReloadPlan,
  type ReloadProgress,
} from '../api/tauri';

function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} Tage`;
}

export function UpdatePanel() {
  const tauriOn = isTauri();
  const [plan, setPlan] = useState<ReloadPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ReloadProgress | null>(null);

  const refresh = useCallback(async () => {
    if (!tauriOn) return;
    try {
      const p = await tauri.planLocalReload();
      setPlan(p);
    } catch (err) {
      console.warn('plan_local_reload failed', err);
    }
  }, [tauriOn]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!tauriOn) return;
    let unlisten: (() => void) | null = null;
    void listen<ReloadProgress>('reload-progress', (p) => {
      setProgress(p);
      if (p.state === 'done' || p.state === 'error') {
        setBusy(false);
        void refresh();
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, [tauriOn, refresh]);

  const runReload = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProgress({ state: 'stopping', message: 'Stoppe Services…' });
    try {
      await tauri.reloadAll();
    } catch (err) {
      setProgress({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
    }
  };

  if (!tauriOn) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <AlertCircle size={16} className="text-slate-400" />
          System-Update nur in der nativen App verfügbar.
        </div>
      </div>
    );
  }

  const upToDate = plan && !plan.needs_rebuild && !plan.needs_services_restart;
  const Icon = plan?.needs_rebuild ? Hammer : plan?.needs_services_restart ? Zap : CheckCircle2;
  const iconColor = plan?.needs_rebuild
    ? 'text-amber-500'
    : plan?.needs_services_restart
      ? 'text-rose-500'
      : 'text-rose-500';

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 ${iconColor}`}
          >
            <Icon size={20} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">
              {upToDate
                ? 'System auf neuestem Stand'
                : plan?.needs_rebuild
                  ? 'Neue Version bereit zum Bauen'
                  : plan?.needs_services_restart
                    ? 'Code-Änderungen erkannt'
                    : 'Prüfe Änderungen…'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {upToDate && 'Keine Änderungen seit dem letzten Build.'}
              {plan?.needs_rebuild &&
                'Dashboard oder Rust-Code hat sich geändert — App muss neu gebaut werden (2–3 Min).'}
              {plan?.needs_services_restart &&
                !plan.needs_rebuild &&
                'Bot-TypeScript hat sich geändert — schneller Services-Neustart reicht (~5 s).'}
            </p>
            {plan && plan.bundle_age_seconds > 0 && Number.isFinite(plan.bundle_age_seconds) && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                <FileClock size={11} />
                Letzter Build vor {formatAge(plan.bundle_age_seconds)}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void refresh()}
            className="rounded-md border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600"
            title="Erneut prüfen"
            disabled={busy}
          >
            <RotateCw size={13} />
          </button>
          <button
            onClick={() => void runReload()}
            disabled={busy || upToDate === true}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition ${
              upToDate
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : plan?.needs_rebuild
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-brand-600 text-white hover:bg-brand-700'
            } disabled:opacity-60`}
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {busy
              ? 'Arbeite…'
              : plan?.needs_rebuild
                ? 'Jetzt neu bauen'
                : 'Jetzt aktualisieren'}
          </button>
        </div>
      </div>

      {progress && (
        <div
          className={`mt-4 rounded-md border p-3 text-xs ${
            progress.state === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : progress.state === 'done'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-brand-200 bg-brand-50 text-brand-800'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {progress.state === 'done' ? (
              <CheckCircle2 size={13} />
            ) : progress.state === 'error' ? (
              <AlertCircle size={13} />
            ) : (
              <Loader2 size={13} className="animate-spin" />
            )}
            {progress.message}
          </div>
          {progress.state === 'relaunching' && (
            <div className="mt-1 text-[11px] opacity-80">
              Die App schließt gleich — bitte via Dock / Launcher neu öffnen.
            </div>
          )}
        </div>
      )}

      {plan && plan.changed.length > 0 && (
        <details className="mt-3 text-[11px]">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            {plan.changed.length} geänderte Datei(en) zeigen
          </summary>
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px] text-slate-500">
            {plan.changed.map((f, i) => (
              <li key={i} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
