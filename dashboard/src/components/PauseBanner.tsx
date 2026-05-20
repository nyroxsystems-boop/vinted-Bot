import { useCallback, useEffect, useState } from 'react';
import { Pause, Play, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { fmtRelative } from '../lib/format';
import { toast } from './Toast';

interface PauseStatus {
  ok: boolean;
  paused: boolean;
  paused_reason: string | null;
  captcha_alert_at: string | null;
}

export function PauseBanner() {
  const [status, setStatus] = useState<PauseStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<PauseStatus>('/captcha/pause-status');
      setStatus(r);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!status?.paused) return null;

  const isCaptcha = !!status.captcha_alert_at;

  async function resume() {
    setBusy(true);
    try {
      await api.post('/captcha/resume', {});
      toast.success('System läuft wieder');
      await load();
    } catch (e) {
      toast.error('Resume fehlgeschlagen', { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  // CAPTCHA = real blocker. Show full banner so the user can't miss it.
  if (isCaptcha) {
    return (
      <div className="z-40 border-b border-amber-500/30 bg-gradient-to-r from-amber-500/[0.07] via-amber-500/[0.10] to-amber-500/[0.07] backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30">
              <ShieldAlert size={17} className="text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
                CAPTCHA blockiert das System
                {status.captcha_alert_at && (
                  <span className="text-[11px] font-normal text-amber-300/80">
                    · seit {fmtRelative(status.captcha_alert_at)}
                  </span>
                )}
              </div>
              <div className="text-xs text-amber-200/80">
                Öffne Vinted/Kleinanzeigen im Browser und löse das CAPTCHA — danach „Weiter".
              </div>
            </div>
          </div>
          <button onClick={resume} disabled={busy} className="btn-success disabled:opacity-50">
            <Play size={14} />
            {busy ? '…' : 'Weiter'}
          </button>
        </div>
      </div>
    );
  }

  // Manual pause = user-triggered, no urgency. Slim one-line bar with an
  // inline resume action — does not eat layout real-estate.
  return (
    <div className="z-40 border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 text-[12px] text-zinc-400">
        <div className="flex items-center gap-2 min-w-0">
          <Pause size={12} className="text-zinc-500 shrink-0" />
          <span className="truncate">
            <span className="font-semibold text-zinc-300">Pausiert.</span>{' '}
            {status.paused_reason ?? 'Manuell via Einstellungen.'}
          </span>
        </div>
        <button
          onClick={resume}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
        >
          <Play size={11} />
          <span className="font-semibold">{busy ? '…' : 'Weiter'}</span>
        </button>
      </div>
    </div>
  );
}
