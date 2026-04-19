import { useState } from 'react';
import { KeyRound, CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react';
import { useAuthStatus, hasBotAuth, type BotAuth } from '../hooks/useAuth';

export function AuthPanel() {
  const { data, loading, startLogin } = useAuthStatus(3000);

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-50 text-brand-700">
          <KeyRound size={16} />
        </div>
        <h2 className="font-semibold">Logins &amp; Sessions</h2>
      </div>

      <p className="text-xs text-slate-500">
        Der Bot braucht gültige Vinted- und Temu-Sessions. Wenn du unten auf „Login starten"
        klickst, öffnet der Bot ein Browser-Fenster — du meldest dich manuell an, der Rest
        (Cookie-Persistenz, Session-Refresh) passiert automatisch.
      </p>

      {loading && <div className="text-sm text-slate-400">Lade…</div>}

      {data && (
        <>
          <BotRow
            label="Vinted"
            auth={data.vinted}
            onLogin={() => startLogin('vinted')}
            hint="Einmaliger Login mit E-Mail/Passwort (+ SMS-Code). Session hält ~2–4 Wochen."
          />
          <BotRow
            label="Temu"
            auth={data.temu}
            onLogin={() => startLogin('temu')}
            hint="Bei Temu einloggen UND einmal Zahlungsmethode (PayPal/Klarna) durchklicken im selben Fenster."
          />
        </>
      )}
    </div>
  );
}

function BotRow(props: {
  label: string;
  auth: BotAuth | { error: string };
  onLogin: () => Promise<void>;
  hint: string;
}) {
  const [busy, setBusy] = useState(false);

  if (!hasBotAuth(props.auth)) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {props.label}-Bot nicht erreichbar: {props.auth.error}
      </div>
    );
  }

  const { session, login } = props.auth;
  const loginBusy = login.state === 'waiting';

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SessionIndicator state={session.state} loginState={login.state} />
          <div>
            <div className="text-sm font-semibold">{props.label}</div>
            <div className="text-xs text-slate-500">
              {loginBusy
                ? login.message
                : session.state === 'valid'
                  ? `Session OK (zuletzt geprüft: ${formatTs(session.checked_at)})`
                  : session.state === 'invalid'
                    ? `Session ungültig — Login nötig${session.message ? `: ${session.message}` : ''}`
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
        <div className="mt-2 flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Ein Browser-Fenster sollte sich geöffnet haben. Dort einloggen — der Bot
            erkennt das automatisch und speichert die Session.
          </span>
        </div>
      )}
      {login.state === 'failed' && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 p-2 text-xs text-red-700">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>Login fehlgeschlagen: {login.message}</span>
        </div>
      )}
      {login.state === 'success' && login.finished_at && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-green-50 p-2 text-xs text-green-700">
          <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
          <span>Erfolgreich gespeichert um {formatTs(login.finished_at)}</span>
        </div>
      )}

      <div className="mt-1.5 text-[11px] text-slate-400">{props.hint}</div>
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
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }
  if (state === 'valid') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700">
        <CheckCircle2 size={14} />
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700">
        <AlertTriangle size={14} />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
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

/** Returns true if either bot needs login. Used for the Overview banner. */
export function anyBotNeedsLogin(a: {
  vinted: BotAuth | { error: string };
  temu: BotAuth | { error: string };
}): null | 'vinted' | 'temu' | 'both' {
  const vNeeds = hasBotAuth(a.vinted) && a.vinted.session.state === 'invalid';
  const tNeeds = hasBotAuth(a.temu) && a.temu.session.state === 'invalid';
  if (vNeeds && tNeeds) return 'both';
  if (vNeeds) return 'vinted';
  if (tNeeds) return 'temu';
  return null;
}
