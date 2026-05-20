import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface CaptchaStatus { ok: boolean; provider: string; apiKeySet: boolean; autoPause: boolean }
interface Balance { ok: boolean; provider?: string; balance_usd?: number; error?: string }
interface Stats { ok: boolean; captchas_last_30d: number; last_captcha_at: string | null; whisper_available: boolean; provider: string }

export function CaptchaPanel() {
  const [status, setStatus] = useState<CaptchaStatus | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, b, st] = await Promise.all([
      api.get<CaptchaStatus>('/captcha/status'),
      api.get<Balance>('/captcha/balance').catch(e => ({ ok: false, error: String(e) }) as Balance),
      api.get<Stats>('/captcha/stats').catch(e => ({ ok: false, captchas_last_30d: 0, last_captcha_at: null, whisper_available: false, provider: 'manual' }) as Stats),
    ]);
    setStatus(s);
    setBalance(b);
    setStats(st);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function setProvider(provider: string) {
    setBusy(true);
    await api.put('/captcha/config', { provider }).finally(() => setBusy(false));
    await load();
  }
  async function setAutoPause(v: boolean) {
    setBusy(true);
    await api.put('/captcha/config', { auto_pause: v }).finally(() => setBusy(false));
    await load();
  }

  if (!status) return <div className="card">Lade CAPTCHA-Konfig…</div>;

  const solvesLeft = balance?.balance_usd != null ? Math.floor(balance.balance_usd / 0.003) : 0;
  const lowBalance = solvesLeft < 100;

  const isManual = status.provider === 'manual' || !status.apiKeySet;
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-zinc-100">CAPTCHA-Handling</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
        <div className="mb-1 font-semibold text-zinc-200">3 Optionen — alle haben 0€-Pfad:</div>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>Whisper (0€, lokal):</b> reCAPTCHA/hCaptcha haben Audio-Option.
            whisper-cli transkribiert offline. Setup: <code className="rounded bg-zinc-800 px-1 py-0.5">brew install whisper-cpp</code>.
            Status: {stats?.whisper_available
              ? <span className="text-rose-300">installiert &amp; bereit</span>
              : <span className="text-amber-300">noch nicht installiert</span>}
          </li>
          <li>
            <b>Manual:</b> bei CAPTCHA pausiert das System. Du löst manuell im Browser, klickst „Resume". Realistisch 1–5×/Monat bei gewärmten Sessions.
          </li>
          <li>
            <b>2captcha (~$1/1000 solves):</b> auto-solve in ≤3 s. Bei 50 Sales/Tag ~$0.03–0.10 / Monat — technisch &gt;0€.
          </li>
        </ul>
        {stats && (
          <div className="mt-2 text-xs text-zinc-400">
            CAPTCHAs letzte 30 Tage: <b className="text-zinc-200">{stats.captchas_last_30d}</b>
            {stats.last_captcha_at && <> · zuletzt: {stats.last_captcha_at}</>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="kpi-label">Provider</div>
          <select value={status.provider} onChange={e => setProvider(e.target.value)} disabled={busy}
                  className="input mt-1.5">
            <option value="2captcha">2captcha</option>
            <option value="capmonster">capmonster</option>
            <option value="manual">manual (kein Auto-Solve)</option>
          </select>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="kpi-label">API-Key</div>
          <div className="mt-2">
            {status.apiKeySet
              ? <span className="badge-good">in .env hinterlegt</span>
              : <span className="badge-warn">fehlt</span>}
          </div>
        </div>
        <div className={`rounded-lg border p-3 ${lowBalance && balance?.ok ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
          <div className="kpi-label">Saldo</div>
          {balance?.ok ? (
            <div className="mt-1">
              <div className="kpi-value">${balance.balance_usd?.toFixed(2)}</div>
              <div className="text-xs text-zinc-500">≈ {solvesLeft} solves</div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-rose-300">{balance?.error ?? '—'}</div>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={status.autoPause} onChange={e => setAutoPause(e.target.checked)} disabled={busy} className="accent-indigo-500" />
        System automatisch pausieren wenn CAPTCHA nicht gelöst werden kann
      </label>

      {!isManual && (
        <button onClick={() => void load()} className="btn-secondary text-xs">Saldo aktualisieren</button>
      )}
      {isManual && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
          Manual-Modus aktiv. Bei CAPTCHA siehst du oben einen Banner mit Resume-Button.
        </div>
      )}
    </div>
  );
}
