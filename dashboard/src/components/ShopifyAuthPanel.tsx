import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface ShopifyAuth {
  ok: boolean;
  shop: string;
  access_token_set: boolean;
  enabled: boolean;
}

export function ShopifyAuthPanel() {
  const [state, setState] = useState<ShopifyAuth | null>(null);
  const [shop, setShop] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<ShopifyAuth>('/shopify/auth');
    setState(r);
    setShop(r.shop);
    setEnabled(r.enabled);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = { enabled };
      if (shop !== state?.shop) body.shop = shop;
      if (accessToken) body.access_token = accessToken;
      await api.put('/shopify/auth', body);
      setAccessToken('');
      await load();
    } finally { setSaving(false); }
  }

  async function testConnection() {
    setTestMsg('…');
    try {
      const r = await api.post<{ ok: boolean; message?: string; error?: string }>('/shopify/auth/test', {});
      setTestMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.error}`);
    } catch (e) {
      setTestMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!state) return <div className="card">Lade Shopify-Konfig…</div>;

  const ok = testMsg?.startsWith('✓');
  const bad = testMsg?.startsWith('✗');

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-100">Shopify (Custom App)</h2>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-rose-500" />
          Crosslisting aktiv
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        Im Shopify-Admin: Apps → „Develop apps" → Create app → Configure Admin API scopes
        (mind. <code className="rounded bg-zinc-800 px-1">read_products</code>,{' '}
        <code className="rounded bg-zinc-800 px-1">write_products</code>,{' '}
        <code className="rounded bg-zinc-800 px-1">read_orders</code>) → Install →
        Admin API access token kopieren („<code>shpat_…</code>").
      </p>

      <label className="block">
        <div className="label">Shop-Domain</div>
        <input value={shop} onChange={e => setShop(e.target.value)}
               className="input font-mono"
               placeholder="myshop.myshopify.com" />
        <div className="mt-1 text-[11px] text-zinc-500">
          Nur die Subdomain reicht — wir hängen <code>.myshopify.com</code> automatisch an, falls fehlt.
        </div>
      </label>

      <label className="block">
        <div className="label flex items-center gap-2">
          <span>Admin API Access Token</span>
          {state.access_token_set && <span className="badge-good">gespeichert</span>}
        </div>
        <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)}
               className="input font-mono"
               placeholder={state.access_token_set ? '••••••• (leer lassen um zu behalten)' : 'shpat_...'} />
      </label>

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '…' : 'Speichern'}
        </button>
        <button onClick={testConnection}
                disabled={saving || !state.access_token_set || !state.shop}
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
