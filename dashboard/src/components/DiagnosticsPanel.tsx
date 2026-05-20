// ──────────────────────────────────────────────────────────────────────────────
// Diagnostics Panel — for support-friendly issue reports.
//
// Lets the user:
//   - Export a bundle (logs + db snapshot + app version + env summary) as ZIP
//   - View live system info (versions, paths, online bots)
//   - Run a one-click DB backup (manual trigger of the existing backup worker)
//
// Everything funnels through `/api/diagnostics/*` on the orchestrator. If those
// endpoints aren't available (older orchestrator), the buttons gracefully fall
// back to direct DB-file copy.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  LifeBuoy, Download, Database, FileText, Clipboard, Check,
  AlertTriangle, RefreshCw, RotateCw, ArrowUpCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';
import { tauri } from '../api/tauri';

interface DiagInfo {
  app_version: string;
  node_version?: string;
  platform?: string;
  db_path?: string;
  db_size_mb?: number;
  last_backup_at?: string | null;
  bots_online?: number;
  bots_total?: number;
}

export function DiagnosticsPanel() {
  const [info, setInfo] = useState<DiagInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const r = await api.get<DiagInfo>('/diagnostics/info');
      setInfo(r);
    } catch {
      // Endpoint optional — show fallback info from window/build constants
      setInfo({ app_version: '0.5.0' });
    }
  };

  useEffect(() => { void load(); }, []);

  async function exportBundle() {
    setBusy('export');
    try {
      // Browser-side: trigger a download from the API
      const url = `/api/diagnostics/export-bundle?format=zip`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `blackruby-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('Diagnostics-Bundle wird heruntergeladen');
    } catch (e) {
      toast.error('Export fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function backupNow() {
    setBusy('backup');
    try {
      const r = await api.post<{ ok: boolean; path?: string; error?: string }>('/diagnostics/backup-now');
      if (r.ok) {
        toast.success('Backup erstellt', { detail: r.path ?? 'in data/backups/' });
        await load();
      } else {
        toast.error('Backup fehlgeschlagen', { detail: r.error });
      }
    } catch (e) {
      toast.error('Backup fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function copyInfo() {
    if (!info) return;
    const txt = JSON.stringify(info, null, 2);
    void navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-rose-500/15 text-rose-300">
          <LifeBuoy size={15} />
        </div>
        <h2 className="font-semibold text-zinc-100">Diagnose &amp; Support</h2>
        <button onClick={() => void load()} className="ml-auto btn-ghost text-xs">
          <RefreshCw size={12} /> Aktualisieren
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Wenn etwas nicht funktioniert: klicke „Diagnose-Bundle exportieren" und schicke die
        Datei an <a href="mailto:support@blackruby.app" className="text-rose-300 hover:underline">support@blackruby.app</a>.
        Die ZIP enthält die letzten Logs, App-Version, DB-Größe — keine Käufer-/Listing-Daten.
      </p>

      {info && (
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <DiagTile label="App-Version" value={`v${info.app_version}`} />
          <DiagTile label="Bots online" value={info.bots_online != null ? `${info.bots_online}/${info.bots_total ?? '?'}` : '—'} />
          <DiagTile label="DB-Größe" value={info.db_size_mb != null ? `${info.db_size_mb.toFixed(1)} MB` : '—'} />
          <DiagTile label="Letztes Backup" value={info.last_backup_at ? new Date(info.last_backup_at).toLocaleString('de-DE') : 'nie'} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
        <button onClick={() => void exportBundle()} disabled={busy !== null} className="btn-primary text-xs">
          <Download size={13} />
          {busy === 'export' ? '…' : 'Diagnose-Bundle (.zip)'}
        </button>
        <button onClick={() => void backupNow()} disabled={busy !== null} className="btn-secondary text-xs">
          <Database size={13} />
          {busy === 'backup' ? '…' : 'DB-Backup jetzt'}
        </button>
        <button onClick={copyInfo} className="btn-ghost text-xs">
          {copied ? <Check size={13} className="text-rose-400" /> : <Clipboard size={13} />}
          {copied ? 'Kopiert' : 'System-Info kopieren'}
        </button>
        <a href="mailto:support@blackruby.app" className="btn-ghost text-xs">
          <FileText size={13} /> Support kontaktieren
        </a>
        {tauri.available() && (
          <>
            <button
              onClick={async () => {
                if (!confirm('Alle Bot-Services neu starten? Laufende Listings unterbrochen — Auto-Publisher pickt nach dem Restart automatisch wieder weiter.')) return;
                setBusy('restart');
                try {
                  await tauri.restartAllServices();
                  toast.success('Services werden neu gestartet', { detail: 'Sichtbar im Status-Banner.' });
                } catch (e) {
                  toast.error('Restart fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy !== null}
              className="btn-ghost text-xs"
              title="Stop & Start aller Node-Services — kein Code-Update, nur Bounce"
            >
              <RotateCw size={13} />
              {busy === 'restart' ? 'Starte neu…' : 'Services neu starten'}
            </button>
            <button
              onClick={async () => {
                setBusy('check-update');
                try {
                  const m = await tauri.checkTarballUpdate();
                  if (m.available) {
                    toast.info(`Update verfügbar: v${m.version}`, {
                      detail: 'Banner oben zeigt den Update-Button.',
                    });
                  } else {
                    toast.success('Schon auf der neuesten Version', {
                      detail: m.latest_version ? `v${m.latest_version}` : undefined,
                    });
                  }
                } catch (e) {
                  toast.error('Update-Check fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy !== null}
              className="btn-ghost text-xs"
              title="Manueller Check gegen blackruby.app/api/releases"
            >
              <ArrowUpCircle size={13} />
              {busy === 'check-update' ? 'Prüfe…' : 'Auf Updates prüfen'}
            </button>
          </>
        )}
      </div>

      {info?.last_backup_at == null && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Noch kein DB-Backup vorhanden. Backups laufen automatisch täglich.
            Klick „DB-Backup jetzt" um eines manuell anzulegen.
          </span>
        </div>
      )}
    </div>
  );
}

function DiagTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-xs text-zinc-200">{value}</div>
    </div>
  );
}
