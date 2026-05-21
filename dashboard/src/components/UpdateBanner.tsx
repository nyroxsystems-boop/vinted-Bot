// ──────────────────────────────────────────────────────────────────────────────
// In-app tarball update banner.
//
// Polls `check_tarball_update` once per hour. When the marketing-API reports
// a newer version:
//   • If `requires_native_reinstall` → static banner that links to the
//     Members-Area for a fresh installer (rare — only when the Tauri shell
//     itself changed).
//   • Otherwise → "Update verfügbar" with a button. Clicking opens a modal
//     that streams `tarball-update-progress` events from Rust:
//       1. Download tarball   (0–35 %)
//       2. Verify SHA + sig   (35–55 %)
//       3. Snapshot + stop    (55–70 %)
//       4. Extract            (70–85 %)
//       5. npm install        (85–92 %)
//       6. Restart services   (92–100 %)
//
// Outside Tauri (browser preview) we render nothing — there's no native
// shell to apply the update to.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, AlertTriangle, X, ExternalLink, Loader2 } from 'lucide-react';
import { tauri, listen, type TarballManifest, type TarballUpdateProgress } from '../api/tauri';
import { toast } from './Toast';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h after startup — first check is immediate
const SKIP_KEY = 'br_skipped_tarball_version';
// `auto_apply_on_startup`: if set to 'true' (default) every fresh launch
// detects a new version and applies it before the user can click anything.
// Stored in localStorage so the Tauri settings table doesn't have to round-trip.
const AUTO_APPLY_KEY = 'br_auto_apply_updates';

function autoApplyEnabled(): boolean {
  try {
    const v = localStorage.getItem(AUTO_APPLY_KEY);
    return v === null ? true : v === 'true'; // default ON
  } catch {
    return true;
  }
}

export function UpdateBanner() {
  const [manifest, setManifest] = useState<TarballManifest | null>(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<TarballUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoApplyAttempted = useRef(false);

  const check = useCallback(async () => {
    if (!tauri.available()) return;
    try {
      const m = await tauri.checkTarballUpdate();
      if (m.available) setManifest(m);
      else setManifest(null);
    } catch {
      // Backend offline — silent. OrchestratorHealthBanner handles that case.
    }
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [check]);

  // Subscribe to progress events while the modal is open.
  useEffect(() => {
    if (!open || !tauri.available()) return;
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      unlistenFn = await listen<TarballUpdateProgress>('tarball-update-progress', (e: TarballUpdateProgress) => {
        if (cancelled) return;
        setProgress(e);
        if (e.phase === 'error') setError(e.message);
      });
    })();
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [open]);

  const apply = useCallback(async (silent = false) => {
    if (!manifest) return;
    setBusy(true);
    setError(null);
    setOpen(true);
    setProgress({ phase: 'downloading', percent: 1, message: 'Starte Update…' });
    try {
      await tauri.applyTarballUpdate(manifest);
      toast.success(`Update auf v${manifest.version} fertig`, {
        detail: 'Webview lädt neu …',
      });
      setManifest(null);
      setOpen(false);
      // Reload after a short delay so the user sees the success toast, then
      // the webview picks up the new dashboard/dist bundle. Without this the
      // running app keeps the old assets until the user manually reloads.
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (silent) {
        // Auto-apply failed — surface as toast so the user notices.
        toast.error('Auto-Update fehlgeschlagen', {
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [manifest]);

  // Auto-apply on detection: when a fresh app launch finds an available
  // update AND the user hasn't opted out, run apply() automatically after a
  // short countdown so the user sees what's happening. They can still hit
  // "Abbrechen" or skip the version.
  useEffect(() => {
    if (!manifest?.available) return;
    if (manifest.requires_native_reinstall) return;
    if (!manifest.tarball_url) return;
    if (autoApplyAttempted.current) return;
    if (!autoApplyEnabled()) return;
    if (localStorage.getItem(SKIP_KEY) === manifest.version) return;

    autoApplyAttempted.current = true;
    const grace = 5;
    toast.info(`Auto-Update auf v${manifest.version}`, {
      detail: `Wird in ${grace} s angewendet. Klick „Auto-Update aus" in Settings um das abzuschalten.`,
      duration: grace * 1000,
    });
    const t = setTimeout(() => void apply(true), grace * 1000);
    return () => clearTimeout(t);
  }, [manifest, apply]);

  function skipThisVersion() {
    if (manifest?.version) localStorage.setItem(SKIP_KEY, manifest.version);
    setManifest(null);
  }

  if (!manifest || !manifest.available) return null;
  if (localStorage.getItem(SKIP_KEY) === manifest.version) return null;

  // Native-reinstall path — no in-app upgrade possible.
  if (manifest.requires_native_reinstall || !manifest.tarball_url) {
    return (
      <div className="z-40 border-b border-amber-500/30 bg-amber-500/[0.08] backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm text-amber-100">
          <div className="flex items-center gap-3 min-w-0">
            <ArrowUpCircle size={15} className="shrink-0 text-amber-300" />
            <div className="min-w-0">
              <span className="font-bold">Großes Update: v{manifest.version}</span>
              <span className="ml-1 text-amber-200/85">
                Enthält App-Kern-Änderungen — bitte neuen Installer von blackruby.de laden.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://blackruby.de/members"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/10"
            >
              Installer holen <ExternalLink size={11} />
            </a>
            <button
              type="button"
              onClick={skipThisVersion}
              className="rounded p-1 text-amber-300 hover:bg-amber-500/10"
              title="Diese Version überspringen"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="z-40 border-b border-rose-500/30 bg-rose-500/[0.08] backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm text-rose-100">
          <div className="flex items-center gap-3 min-w-0">
            <ArrowUpCircle size={15} className="shrink-0 text-rose-300" />
            <div className="min-w-0">
              <span className="font-bold">Update verfügbar: v{manifest.version}</span>
              {manifest.notes && manifest.notes.length > 0 && (
                <span className="ml-1 text-rose-200/80">{manifest.notes[0]}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded bg-rose-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-400"
            >
              Jetzt aktualisieren
            </button>
            <button
              type="button"
              onClick={skipThisVersion}
              className="rounded p-1 text-rose-300 hover:bg-rose-500/10"
              title="Diese Version überspringen"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/85 px-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-7 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
                <ArrowUpCircle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Update auf v{manifest.version}</h2>
                <p className="text-xs text-zinc-400">
                  {progress ? progress.message : 'Bereit zum Installieren.'}
                </p>
              </div>
            </div>

            {manifest.notes && manifest.notes.length > 0 && !busy && (
              <ul className="mt-5 space-y-1 text-xs text-zinc-300">
                {manifest.notes.slice(0, 6).map((n, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-rose-400" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}

            {progress && (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-rose-500 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                  {progress.phase !== 'done' && progress.phase !== 'error' && (
                    <Loader2 size={11} className="animate-spin" />
                  )}
                  <span className="tabular">{progress.percent}%</span>
                  <span className="uppercase tracking-wider">{progress.phase}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2 border-t border-white/5 pt-5">
              {progress?.phase === 'done' ? (
                <button onClick={() => { setOpen(false); setProgress(null); }} className="btn-primary">
                  Fertig
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { if (!busy) setOpen(false); }}
                    disabled={busy}
                    className="btn-ghost disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={() => void apply()}
                    disabled={busy}
                    className="btn-primary disabled:opacity-60"
                  >
                    {busy ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Update läuft…
                      </>
                    ) : (
                      <>Jetzt aktualisieren</>
                    )}
                  </button>
                </>
              )}
            </div>

            <p className="mt-4 text-[10px] text-zinc-600">
              Services werden kurz gestoppt und mit neuem Code wieder gestartet. Listings verlieren keine Daten — DB bleibt unangetastet.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
