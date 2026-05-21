// ──────────────────────────────────────────────────────────────────────────────
// Updates panel — dedicated section in Settings.
//
//   • Always-visible "Nach Updates suchen" button (in addition to the
//     hourly auto-check that the UpdateBanner does in the background).
//   • Shows the current app version + the manifest URL it's polling.
//   • If an update is found: notes + "Jetzt aktualisieren" button that runs
//     the same apply-flow as the banner.
//   • Outside the Tauri shell (browser preview), the panel renders a hint
//     instead of being hidden — so the user can confirm the section exists
//     and knows in-app upgrades only work in the packaged app.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpCircle, Check, Loader2, RefreshCw, ExternalLink, AlertTriangle, Zap,
} from 'lucide-react';
import {
  tauri, listen,
  type TarballManifest, type TarballUpdateProgress, type VersionInfo,
} from '../api/tauri';
import { toast } from './Toast';

const AUTO_APPLY_KEY = 'br_auto_apply_updates';

function readAutoApply(): boolean {
  try {
    const v = localStorage.getItem(AUTO_APPLY_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export function UpdatesPanel() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [manifest, setManifest] = useState<TarballManifest | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<TarballUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoApply, setAutoApplyState] = useState<boolean>(readAutoApply);

  // Load installed version once on mount (Tauri only).
  useEffect(() => {
    if (!tauri.available()) return;
    void tauri.appVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  // Subscribe to progress events whenever apply is running.
  useEffect(() => {
    if (!applying || !tauri.available()) return;
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;
    void (async () => {
      unlistenFn = await listen<TarballUpdateProgress>('tarball-update-progress', (e: TarballUpdateProgress) => {
        if (cancelled) return;
        setProgress(e);
        if (e.phase === 'error') setError(e.message);
      });
    })();
    return () => { cancelled = true; unlistenFn?.(); };
  }, [applying]);

  const check = useCallback(async () => {
    if (!tauri.available()) {
      toast.info('Manueller Update-Check', { detail: 'Nur in der Desktop-App verfügbar.' });
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const m = await tauri.checkTarballUpdate();
      setManifest(m);
      setLastChecked(new Date());
      if (m.available) {
        toast.info(`Update gefunden: v${m.version}`, { detail: 'Siehe unten — „Jetzt aktualisieren".' });
      } else {
        toast.success('Schon auf der neuesten Version', {
          detail: m.latest_version ? `Server: v${m.latest_version}` : undefined,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error('Update-Check fehlgeschlagen', { detail: msg });
    } finally {
      setChecking(false);
    }
  }, []);

  const apply = useCallback(async () => {
    if (!manifest || !tauri.available()) return;
    setApplying(true);
    setError(null);
    setProgress({ phase: 'downloading', percent: 1, message: 'Update wird vorbereitet …' });
    try {
      await tauri.applyTarballUpdate(manifest);
      toast.success(`Update auf v${manifest.version} fertig`);
      setManifest({ ...manifest, available: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setApplying(false);
    }
  }, [manifest]);

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/15 text-rose-300">
          <ArrowUpCircle size={15} />
        </div>
        <h2 className="font-semibold text-zinc-100">Updates</h2>
        <span className="ml-auto text-[11px] text-zinc-500">
          {tauri.available() ? 'Tarball-Updater · stündlicher Auto-Check' : 'nur in der Desktop-App verfügbar'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Installierte Version
          </div>
          <div className="mt-1 tabular text-base font-bold text-zinc-100">
            {version ? `v${version.version}` : tauri.available() ? '…' : '— (im Browser nicht abrufbar)'}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Update-Server
          </div>
          <div className="mt-1 truncate font-mono text-xs text-zinc-300">
            {version?.manifest_url ?? 'https://blackruby.de'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking || applying}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {checking ? 'Suche …' : 'Nach Updates suchen'}
        </button>
        {lastChecked && (
          <span className="text-[11px] text-zinc-500">
            Letzte Prüfung: {lastChecked.toLocaleTimeString('de-DE')}
          </span>
        )}
      </div>

      {/* Auto-apply toggle — defaults ON so the user opens the app and finds
          it already on the latest version, no manual click required. */}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Zap size={14} className="mt-0.5 shrink-0 text-rose-300" />
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              Beim App-Start automatisch aktualisieren
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Wenn aktiv, lädt die App bei jedem Öffnen die neueste Version still im Hintergrund.
              Du siehst eine 5-Sekunden-Vorwarnung und kannst abbrechen.
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoApply}
          data-on={autoApply ? 'true' : 'false'}
          className="toggle shrink-0"
          onClick={() => {
            const next = !autoApply;
            setAutoApplyState(next);
            try { localStorage.setItem(AUTO_APPLY_KEY, next ? 'true' : 'false'); } catch { /* */ }
          }}
        >
          <span className="toggle-thumb" />
        </button>
      </div>

      {/* Available-update card */}
      {manifest?.available && manifest.version && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
                Neue Version verfügbar
              </div>
              <div className="mt-0.5 tabular text-2xl font-bold text-zinc-100">v{manifest.version}</div>
              {manifest.released_at && (
                <div className="text-[11px] text-zinc-500">
                  Released {new Date(manifest.released_at).toLocaleDateString('de-DE')}
                </div>
              )}
            </div>
            {!manifest.requires_native_reinstall && !applying && progress?.phase !== 'done' && (
              <button onClick={() => void apply()} className="btn-primary text-sm">
                <ArrowUpCircle size={14} /> Jetzt aktualisieren
              </button>
            )}
            {manifest.requires_native_reinstall && (
              <a
                href="https://blackruby.de/members"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                Installer holen <ExternalLink size={11} />
              </a>
            )}
          </div>

          {manifest.notes && manifest.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-zinc-300">
              {manifest.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check size={11} className="mt-0.5 shrink-0 text-rose-400" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {manifest.requires_native_reinstall && (
            <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-200/90">
              <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-300" />
              <span>
                Dieses Update enthält Änderungen am App-Kern (Tauri-Shell) — bitte den neuen Installer
                manuell laden.
              </span>
            </div>
          )}

          {progress && applying && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-rose-500 transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
                <Loader2 size={11} className="animate-spin" />
                <span className="tabular">{progress.percent}%</span>
                <span className="uppercase tracking-wider text-zinc-500">{progress.phase}</span>
                <span>· {progress.message}</span>
              </div>
            </div>
          )}

          {progress?.phase === 'done' && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 p-2 text-xs text-zinc-200">
              <Check size={12} className="mt-0.5 shrink-0 text-rose-300" />
              <span>
                Update fertig — Services laufen jetzt mit v{manifest.version}.
              </span>
            </div>
          )}
        </div>
      )}

      {manifest && !manifest.available && (
        <div className="flex items-start gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 p-3 text-xs text-zinc-300">
          <Check size={12} className="mt-0.5 shrink-0 text-rose-300" />
          <span>
            Schon auf der neuesten Version
            {manifest.latest_version ? ` (v${manifest.latest_version})` : ''}.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!tauri.available() && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500">
          <span className="font-semibold text-zinc-400">Hinweis:</span> Updates lassen sich nur in der
          gepackten Blackruby-App ziehen — der Web-Preview hat keine Tauri-Shell.
        </div>
      )}
    </div>
  );
}
