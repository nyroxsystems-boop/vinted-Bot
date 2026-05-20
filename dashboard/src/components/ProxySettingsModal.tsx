// ──────────────────────────────────────────────────────────────────────────────
// ProxySettingsModal — per-account residential proxy configuration.
//
// Lets the user paste a Bright Data / Smartproxy / Webshare URL, test it
// live (egress IP + country), and save it. Empty URL → direct connection
// (DELETE the proxy on the account).
//
// Mounted by Accounts.tsx via an onClick trigger — see parallel agent.
// ──────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { X, Wifi, CheckCircle2, AlertTriangle, Loader2, Globe } from 'lucide-react';
import { api } from '../api/client';

interface ProxyTestResult {
  ok: boolean;
  proxyIp?: string;
  directIp?: string;
  changed?: boolean | null;
  country?: string;
  error?: string;
}

export function ProxySettingsModal({
  accountId,
  currentProxyUrl,
  onClose,
  onSave,
}: {
  accountId: number;
  currentProxyUrl: string | null;
  onClose: () => void;
  onSave?: () => void;
}) {
  const [proxyUrl, setProxyUrl] = useState(currentProxyUrl ?? '');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.post<ProxyTestResult>(`/accounts/${accountId}/proxy/test`, {
        proxy_url: proxyUrl,
      });
      setResult(r);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (proxyUrl.trim()) {
        await api.put(`/accounts/${accountId}/proxy`, { proxy_url: proxyUrl.trim() });
      } else {
        await api.del(`/accounts/${accountId}/proxy`);
      }
      onSave?.();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/85 px-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-7 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
            <Wifi size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Residential-Proxy</h2>
            <p className="text-xs text-zinc-400">Account #{accountId} — eigene IP für diesen Account</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Schließen"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block text-xs font-medium text-zinc-300">Proxy-URL</label>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => { setProxyUrl(e.target.value); setResult(null); }}
            placeholder="http://user:pass@gate.smartproxy.com:7000"
            className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-rose-500/60 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Unterstützt: HTTP, HTTPS, SOCKS5 mit Auth. Bright Data / Smartproxy / Webshare URLs einfach reinkopieren.
            Leer lassen für direkte Verbindung.
          </p>
        </div>

        {result && (
          <div className={`mt-4 rounded-lg border p-3 text-xs ${
            result.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}>
            {result.ok ? (
              <div className="flex items-start gap-2">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                <div className="space-y-1">
                  <div className="font-medium">
                    Verbindung OK — IP: {result.proxyIp}
                    {result.country ? ` (${result.country})` : ''}
                  </div>
                  {result.directIp && (
                    <div className="text-[10px] text-emerald-200/70">
                      Direkt-IP: {result.directIp} · {result.changed ? 'IP geändert ✓' : 'IP UNVERÄNDERT — Proxy aktiv?'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rose-400" />
                <div>
                  <div className="font-medium">Fehler</div>
                  <div className="text-[10px] text-rose-200/70">{result.error}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-white/5 pt-5">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !proxyUrl.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
            {testing ? 'Teste…' : 'Test'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="inline animate-spin" /> : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
