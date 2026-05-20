import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface WooAuth {
  ok: boolean;
  url: string;
  consumer_key_set: boolean;
  consumer_secret_set: boolean;
  enabled: boolean;
}

export function WoocommerceAuthPanel() {
  const [state, setState] = useState<WooAuth | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<WooAuth>('/woocommerce/auth');
    setState(r);
    setUrl(r.url);
    setEnabled(r.enabled);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = { enabled };
      if (url !== state?.url) body.url = url;
      if (key) body.consumer_key = key;
      if (secret) body.consumer_secret = secret;
      await api.put('/woocommerce/auth', body);
      setKey('');
      setSecret('');
      await load();
    } finally { setSaving(false); }
  }

  async function testConnection() {
    setTestMsg('…');
    try {
      const r = await api.post<{ ok: boolean; message?: string; error?: string }>('/woocommerce/auth/test', {});
      setTestMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.error}`);
    } catch (e) {
      setTestMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!state) return <div className="card">Lade WooCommerce-Konfig…</div>;

  const ok = testMsg?.startsWith('✓');
  const bad = testMsg?.startsWith('✗');

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-100">WooCommerce (REST API v3)</h2>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-rose-500" />
          Crosslisting aktiv
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        In WordPress-Admin: WooCommerce → Einstellungen → Erweitert → REST API → Schlüssel hinzufügen
        (Rechte: <em>Lesen/Schreiben</em>). Du bekommst Consumer Key (<code>ck_…</code>) und
        Consumer Secret (<code>cs_…</code>) — diese sind nach dem Erstellen <strong>nur einmal sichtbar</strong>.
      </p>

      <label className="block">
        <div className="label">Shop-URL</div>
        <input value={url} onChange={e => setUrl(e.target.value)}
               className="input font-mono"
               placeholder="https://shop.example.com" />
        <div className="mt-1 text-[11px] text-zinc-500">
          HTTPS empfohlen — Basic-Auth-Credentials werden sonst im Klartext übertragen.
        </div>
      </label>

      <label className="block">
        <div className="label flex items-center gap-2">
          <span>Consumer Key</span>
          {state.consumer_key_set && <span className="badge-good">gespeichert</span>}
        </div>
        <input type="password" value={key} onChange={e => setKey(e.target.value)}
               className="input font-mono"
               placeholder={state.consumer_key_set ? '••••••• (leer lassen um zu behalten)' : 'ck_...'} />
      </label>

      <label className="block">
        <div className="label flex items-center gap-2">
          <span>Consumer Secret</span>
          {state.consumer_secret_set && <span className="badge-good">gespeichert</span>}
        </div>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)}
               className="input font-mono"
               placeholder={state.consumer_secret_set ? '••••••• (leer lassen um zu behalten)' : 'cs_...'} />
      </label>

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '…' : 'Speichern'}
        </button>
        <button onClick={testConnection}
                disabled={saving || !state.consumer_key_set || !state.consumer_secret_set || !state.url}
                className="btn-secondary">
          Verbindung testen
        </button>
      </div>
      {testMsg && (
        <div className={`rounded-md border p-2 text-xs ${
          ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
             : bad ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
             : 'border-zinc-700 bg-zinc-900 text-zinc-300'
        }`}>
          {testMsg}
        </div>
      )}
    </div>
  );
}
