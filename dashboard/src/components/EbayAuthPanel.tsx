import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface EbayAuth {
  ok: boolean;
  enabled: boolean;
  client_id: string;
  client_secret_set: boolean;
  refresh_token_set: boolean;
  sandbox: boolean;
}

export function EbayAuthPanel() {
  const [state, setState] = useState<EbayAuth | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<EbayAuth>('/ebay/auth');
    setState(r);
    setClientId(r.client_id);
    setSandbox(r.sandbox);
    setEnabled(r.enabled);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = { sandbox, enabled };
      if (clientId) body.client_id = clientId;
      if (clientSecret) body.client_secret = clientSecret;
      if (refreshToken) body.refresh_token = refreshToken;
      await api.put('/ebay/auth', body);
      setClientSecret('');
      setRefreshToken('');
      await load();
    } finally { setSaving(false); }
  }

  async function testConnection() {
    setTestMsg('…');
    try {
      const r = await api.post<{ ok: boolean; message?: string; error?: string }>('/ebay/auth/test', {});
      setTestMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.error}`);
    } catch (e) {
      setTestMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!state) return <div className="card">Lade eBay-Konfig…</div>;

  const ok = testMsg?.startsWith('✓');
  const bad = testMsg?.startsWith('✗');

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-100">eBay-DE OAuth</h2>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-indigo-500" />
          Crosslisting aktiv
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        Refresh-Token holen: developer.ebay.com → Get a User Token. Hier einfügen.
      </p>

      <label className="block">
        <div className="label">Client ID (App-ID)</div>
        <input value={clientId} onChange={e => setClientId(e.target.value)}
               className="input font-mono"
               placeholder="MyApp-PRD-abc123-..." />
      </label>

      <label className="block">
        <div className="label flex items-center gap-2">
          <span>Client Secret (Cert-ID)</span>
          {state.client_secret_set && <span className="badge-good">gespeichert</span>}
        </div>
        <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
               className="input font-mono"
               placeholder={state.client_secret_set ? '••••••• (leer lassen um zu behalten)' : 'PRD-...'} />
      </label>

      <label className="block">
        <div className="label flex items-center gap-2">
          <span>Refresh Token</span>
          {state.refresh_token_set && <span className="badge-good">gespeichert</span>}
        </div>
        <textarea value={refreshToken} onChange={e => setRefreshToken(e.target.value)} rows={3}
                  className="input font-mono text-xs"
                  placeholder={state.refresh_token_set ? '••••••• (leer lassen um zu behalten)' : 'v^1.1#i^1#...'} />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} className="accent-indigo-500" />
        Sandbox-Modus (zum Testen vor Production)
      </label>

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '…' : 'Speichern'}
        </button>
        <button onClick={testConnection} disabled={saving || !state.client_secret_set || !state.refresh_token_set}
                className="btn-secondary">
          Verbindung testen
        </button>
      </div>
      {testMsg && (
        <div className={`rounded-md border p-2 text-xs ${
          ok ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
             : bad ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
             : 'border-zinc-700 bg-zinc-900 text-zinc-300'
        }`}>
          {testMsg}
        </div>
      )}
    </div>
  );
}
