import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2, AlertTriangle, Loader2, Info, Globe } from 'lucide-react';
import { useAuthStatus, hasBotAuth, type BotAuth } from '../hooks/useAuth';
import { api } from '../api/client';
import { MARKETPLACE_LOGINS } from '../lib/marketplace-logins';

export function AuthPanel() {
  const { data, loading, startLogin } = useAuthStatus(3000);
  const navigate = useNavigate();

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/15 text-rose-300">
          <KeyRound size={15} />
        </div>
        <h2 className="font-semibold text-zinc-100">Logins &amp; Sessions</h2>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500">
          <Globe size={11} /> {MARKETPLACE_LOGINS.length} Plattformen
        </span>
      </div>

      <p className="text-xs text-zinc-500">
        Klicke auf „Login starten" um ein Browser-Fenster zu öffnen. Melde dich dort
        manuell an — der Bot speichert die Session automatisch.
      </p>

      {loading && <div className="text-sm text-zinc-400">Lade…</div>}

      {data && (
        <div className="space-y-2">
          {MARKETPLACE_LOGINS.map((pl) => {
            // Status comes from the unified /api/auth/status endpoint — for
            // marketplaces the orchestrator couldn't reach, fall back to a
            // neutral "unknown" so the row still renders.
            const auth: BotAuth | { error: string } = data[pl.id] ?? {
              session: { state: 'unknown', checked_at: null, message: null },
              login:   { state: 'idle',    message: '', started_at: null, finished_at: null },
            };
            return (
              <BotRow
                key={pl.id}
                label={pl.label}
                auth={auth}
                apiOnly={pl.apiOnly === true}
                highRisk={pl.risk === 'high'}
                onLogin={async () => {
                  if (pl.apiOnly) return; // handled via onConfigure (Konfigurieren button)
                  if (pl.id === 'vinted') {
                    await startLogin('vinted');
                  } else {
                    await api.post(`/bot/${pl.id}/login?account=1`);
                  }
                }}
                onConfigure={() => {
                  try { localStorage.setItem('br_settings_tab', 'api-auth'); } catch { /* ignore */ }
                  navigate('/settings');
                }}
                hint={pl.hint}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BotRow(props: {
  label: string;
  auth: BotAuth | { error: string };
  onLogin: () => Promise<void>;
  onConfigure?: () => void;
  apiOnly?: boolean;
  highRisk?: boolean;
  hint: string;
}) {
  const [busy, setBusy] = useState(false);

  // API-only marketplaces: render a streamlined row that links into Settings.
  // The "bot unreachable" guard below would otherwise hide them whenever the
  // status endpoint omits them — but for API-only mps that's expected.
  if (props.apiOnly) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
              <KeyRound size={14} />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">{props.label}</div>
              <div className="text-xs text-zinc-400">API-Token / Schlüssel statt Browser-Login</div>
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={() => props.onConfigure?.()}
          >
            <KeyRound size={14} /> Konfigurieren
          </button>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">{props.hint}</div>
      </div>
    );
  }

  if (!hasBotAuth(props.auth)) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">{props.label}-Bot nicht erreichbar.</span>
          <span className="ml-1 text-amber-200/80">{props.auth.error}</span>
          <div className="mt-0.5 text-[11px] text-amber-300/70">
            Settings → Diagnose → „Services neu starten" oder Bot manuell hochfahren.
          </div>
        </div>
      </div>
    );
  }

  const { session, login } = props.auth;
  const loginBusy = login.state === 'waiting';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SessionIndicator state={session.state} loginState={login.state} />
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-zinc-100">{props.label}</div>
              {props.highRisk && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  <AlertTriangle size={10} /> High-Risk
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-400">
              {loginBusy
                ? login.message
                : session.state === 'valid'
                  ? `Session OK · zuletzt geprüft ${formatTs(session.checked_at)}`
                  : session.state === 'invalid'
                    ? `Session ungültig — Login nötig${session.message ? ` · ${session.message}` : ''}`
                    : session.state === 'checking'
                      ? 'Login-Flow vorbereiten…'
                      : 'Session-Status unbekannt — noch kein Poll gelaufen'}
            </div>
          </div>
        </div>

        <button
          className="btn-primary"
          disabled={busy || loginBusy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onLogin();
            } finally {
              setBusy(false);
            }
          }}
        >
          {loginBusy ? (
            <>
              <Loader2 size={14} className="animate-spin" /> läuft…
            </>
          ) : (
            <>
              <KeyRound size={14} /> Login starten
            </>
          )}
        </button>
      </div>

      {login.state === 'waiting' && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Ein Browser-Fenster sollte sich geöffnet haben. Dort einloggen — der Bot
            erkennt das automatisch und speichert die Session.
          </span>
        </div>
      )}
      {login.state === 'failed' && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Login fehlgeschlagen: {login.message}
            {login.message?.toLowerCase().includes('captcha') && (
              <> · Öffne Vinted manuell, löse das CAPTCHA, dann erneut starten.</>
            )}
          </span>
        </div>
      )}
      {login.state === 'success' && login.finished_at && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 p-2 text-xs text-zinc-300">
          <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-rose-300" />
          <span>Erfolgreich gespeichert um {formatTs(login.finished_at)}</span>
        </div>
      )}

      <div className="mt-2 text-[11px] text-zinc-500">{props.hint}</div>
      {props.highRisk && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          <strong>Hinweis:</strong> Diese Plattform erkennt Automatisierung aggressiv und sperrt
          Konten häufig. Login funktioniert, aber rechne mit kürzeren Sessions, SMS-2FA und einem
          erhöhten Bann-Risiko. Verwende einen separaten Account, nicht dein Haupt-Profil.
        </div>
      )}
    </div>
  );
}

function SessionIndicator({
  state,
  loginState,
}: {
  state: BotAuth['session']['state'];
  loginState: BotAuth['login']['state'];
}) {
  if (loginState === 'waiting' || state === 'checking') {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }
  if (state === 'valid') {
    // Solid neutral with ruby check — "logged in" is the baseline, not a warning.
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-rose-300 ring-1 ring-zinc-700">
        <CheckCircle2 size={14} />
      </div>
    );
  }
  if (state === 'invalid') {
    // Amber — needs your action, but not catastrophic.
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
        <AlertTriangle size={14} />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700">
      <Info size={14} />
    </div>
  );
}

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

/** Returns true if any bot needs login. Used for the Overview banner. */
export function anyBotNeedsLogin(a: Record<string, BotAuth | { error: string }>): string[] {
  const needsLogin: string[] = [];
  for (const [key, val] of Object.entries(a)) {
    if (hasBotAuth(val) && val.session.state === 'invalid') {
      needsLogin.push(key);
    }
  }
  return needsLogin;
}
