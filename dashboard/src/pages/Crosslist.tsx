import { useState, useEffect, useCallback } from 'react';
import { Check, X as XIcon, Clock } from 'lucide-react';

// ── Extension Bridge Hook ────────────────────────────────────────────────────

interface CrosslistStatus {
  platform: string;
  status: 'pending' | 'opening_tab' | 'filling_form' | 'uploading_images' | 'completed' | 'failed';
  message: string;
}

function useExtensionBridge() {
  const [connected, setConnected] = useState(false);
  const [extensionId, setExtensionId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, CrosslistStatus>>({});

  useEffect(() => {
    // Check sessionStorage (set by bridge.js)
    const id = sessionStorage.getItem('BlackrubyCrosslisterId');
    if (id) {
      setConnected(true);
      setExtensionId(id);
    }

    // Listen for bridge messages
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'CROSSLISTER_READY') {
        setConnected(true);
        setExtensionId(event.data.extensionId);
      }
      if (event.data?.type === 'CROSSLIST_STATUS') {
        const { platform, data } = event.data;
        if (platform && data) {
          setStatuses(prev => ({
            ...prev,
            [platform]: { platform, status: data.status, message: data.message },
          }));
        }
      }
      if (event.data?.type === 'CROSSLIST_RESPONSE') {
        // Response from a crosslist request
      }
    };

    window.addEventListener('message', handler);

    // Ping to detect extension
    window.postMessage({ type: 'CROSSLISTER_PING' }, '*');

    return () => window.removeEventListener('message', handler);
  }, []);

  const crosslist = useCallback((platform: string, listingData: Record<string, unknown>) => {
    const requestId = `${platform}_${Date.now()}`;
    setStatuses(prev => ({
      ...prev,
      [platform]: { platform, status: 'pending', message: 'Starting...' },
    }));

    window.postMessage({
      type: 'CROSSLIST_REQUEST',
      platform,
      listingData,
      requestId,
    }, '*');

    return requestId;
  }, []);

  const crosslistBulk = useCallback((platforms: string[], listingData: Record<string, unknown>) => {
    const requestId = `bulk_${Date.now()}`;
    for (const p of platforms) {
      setStatuses(prev => ({
        ...prev,
        [p]: { platform: p, status: 'pending', message: 'Queued...' },
      }));
    }

    window.postMessage({
      type: 'CROSSLIST_BULK',
      platforms,
      listingData,
      requestId,
    }, '*');

    return requestId;
  }, []);

  return { connected, extensionId, statuses, crosslist, crosslistBulk };
}

// ── Platform Config ──────────────────────────────────────────────────────────

const PLATFORMS = [
  // ── Core Marketplaces ──────────────────────────────────────────────────
  { id: 'vinted', name: 'Vinted', icon: '👗', color: '#09B1BA', currency: 'EUR' },
  { id: 'ebay_de', name: 'eBay DE', icon: '🛒', color: '#E53238', currency: 'EUR' },
  { id: 'ebay_uk', name: 'eBay UK', icon: '🇬🇧', color: '#E53238', currency: 'GBP' },
  { id: 'kleinanzeigen', name: 'Kleinanzeigen', icon: '🏠', color: '#86B817', currency: 'EUR' },
  { id: 'depop', name: 'Depop', icon: '🔴', color: '#FF2300', currency: 'GBP' },
  { id: 'etsy', name: 'Etsy', icon: '🧶', color: '#F1641E', currency: 'EUR' },
  { id: 'grailed', name: 'Grailed', icon: '👔', color: '#000', currency: 'USD' },
  { id: 'wallapop', name: 'Wallapop', icon: '🇪🇸', color: '#13C1AC', currency: 'EUR' },
  { id: 'mercari', name: 'Mercari', icon: '🔵', color: '#4DC4FF', currency: 'USD' },
  { id: 'fb_marketplace', name: 'FB Market', icon: '📘', color: '#1877F2', currency: 'EUR' },
  { id: 'poshmark', name: 'Poshmark', icon: '👛', color: '#7F0353', currency: 'USD' },
  // ── Tier 1: Pflicht ────────────────────────────────────────────────────
  { id: 'vestiaire', name: 'Vestiaire', icon: '💎', color: '#C4956A', currency: 'EUR' },
  { id: 'whatnot', name: 'Whatnot', icon: '🎥', color: '#FF6B35', currency: 'USD' },
  { id: 'shopify', name: 'Shopify', icon: '🟢', color: '#96BF48', currency: 'EUR' },
  { id: 'woocommerce', name: 'WooCommerce', icon: '🟣', color: '#96588A', currency: 'EUR' },
  // ── EU Champions ───────────────────────────────────────────────────────
  { id: 'leboncoin', name: 'Leboncoin 🇫🇷', icon: '🇫🇷', color: '#FF6E14', currency: 'EUR' },
  { id: 'marktplaats', name: 'Marktplaats 🇳🇱', icon: '🇳🇱', color: '#F39200', currency: 'EUR' },
  { id: 'willhaben', name: 'Willhaben 🇦🇹', icon: '🇦🇹', color: '#E30613', currency: 'EUR' },
  { id: 'subito', name: 'Subito 🇮🇹', icon: '🇮🇹', color: '#FF4500', currency: 'EUR' },
  { id: 'ricardo', name: 'Ricardo 🇨🇭', icon: '🇨🇭', color: '#E2001A', currency: 'CHF' },
];

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: CrosslistStatus }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>;

  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    opening_tab: 'bg-blue-100 text-blue-700',
    filling_form: 'bg-blue-100 text-blue-700',
    uploading_images: 'bg-rose-100 text-rose-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[status.status] || 'bg-zinc-800 text-zinc-300'}`}>
      {status.status === 'completed' ? <Check size={11} /> : status.status === 'failed' ? <XIcon size={11} /> : <Clock size={11} />}
      {status.message.slice(0, 40)}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function CrosslistPage() {
  const { connected, statuses, crosslist, crosslistBulk } = useExtensionBridge();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [listingData, setListingData] = useState({
    title: '',
    description: '',
    price_eur: 0,
    brand: '',
    condition: 'Sehr gut',
    size: '',
    colors: [] as string[],
    material: '',
    image_urls: [] as string[],
  });
  const [folderNum, setFolderNum] = useState('');

  // Load listing from folder
  const loadFromFolder = async () => {
    if (!folderNum) return;
    try {
      const res = await fetch(`/api/products/${folderNum}`);
      const data = await res.json();
      if (data) {
        setListingData({
          title: data.title || '',
          description: data.description || '',
          price_eur: data.price_eur || 0,
          brand: data.brand || '',
          condition: data.condition || 'Sehr gut',
          size: data.size || '',
          colors: data.colors || [],
          material: data.material || '',
          image_urls: data.image_urls || [],
        });
      }
    } catch (err) {
      console.error('Failed to load listing:', err);
    }
  };

  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedPlatforms(new Set(PLATFORMS.map(p => p.id)));
  };

  const handleCrosslist = () => {
    if (selectedPlatforms.size === 0 || !listingData.title) return;
    crosslistBulk(Array.from(selectedPlatforms), listingData);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">⚡ Crosslisting</h1>
          <p className="text-sm text-gray-500 mt-1">
            Push listings to multiple marketplaces with one click
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${connected ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          {connected ? 'Extension Connected' : 'Extension Not Found'}
        </div>
      </div>

      {!connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <strong>Chrome Extension nicht erkannt.</strong> Installiere die Blackruby Crosslister Extension:
          <ol className="mt-2 ml-4 list-decimal space-y-1">
            <li>Öffne <code className="bg-amber-100 px-1 rounded">chrome://extensions</code></li>
            <li>Aktiviere "Developer mode"</li>
            <li>Klicke "Load unpacked" → wähle <code className="bg-amber-100 px-1 rounded">system/extension/</code></li>
          </ol>
        </div>
      )}

      {/* Load from folder */}
      <div className="bg-white rounded-lg border p-4">
        <label className="text-sm font-medium text-gray-700">Folder laden</label>
        <div className="flex gap-2 mt-1">
          <input
            type="number"
            placeholder="Folder Nr."
            value={folderNum}
            onChange={e => setFolderNum(e.target.value)}
            className="w-32 px-3 py-2 border rounded-md text-sm"
          />
          <button
            onClick={loadFromFolder}
            className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
          >
            Laden
          </button>
        </div>
      </div>

      {/* Listing preview */}
      {listingData.title && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold text-gray-900">{listingData.title}</h3>
          <div className="flex gap-4 text-sm text-gray-600">
            <span>€{listingData.price_eur}</span>
            <span>{listingData.brand}</span>
            <span>{listingData.condition}</span>
            <span>{listingData.size}</span>
          </div>
          <p className="text-sm text-gray-500 line-clamp-2">{listingData.description}</p>
          {listingData.image_urls.length > 0 && (
            <div className="flex gap-2">
              {listingData.image_urls.slice(0, 4).map((url, i) => (
                <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded" />
              ))}
              {listingData.image_urls.length > 4 && (
                <span className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded text-xs text-gray-500">
                  +{listingData.image_urls.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Platform selection */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Ziel-Plattformen</h3>
          <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800">
            Alle auswählen
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              onClick={() => togglePlatform(p.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                selectedPlatforms.has(p.id)
                  ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
              }`}
            >
              <span>{p.icon}</span>
              <span>{p.name}</span>
              {statuses[p.id] && (
                <StatusBadge status={statuses[p.id]} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Action */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleCrosslist}
          disabled={!connected || selectedPlatforms.size === 0 || !listingData.title}
          className={`px-6 py-3 rounded-lg font-semibold text-white shadow-lg transition-all ${
            connected && selectedPlatforms.size > 0 && listingData.title
              ? 'bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 cursor-pointer'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          ⚡ Crosslist to {selectedPlatforms.size} Platform{selectedPlatforms.size !== 1 ? 's' : ''}
        </button>
        <span className="text-sm text-gray-500">
          Extension füllt Formulare aus — du bestätigst auf jeder Plattform.
        </span>
      </div>

      {/* Status log */}
      {Object.keys(statuses).length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Status</h3>
          <div className="space-y-2">
            {Object.values(statuses).map(s => (
              <div key={s.platform} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded">
                <span className="text-sm font-medium text-gray-700">
                  {PLATFORMS.find(p => p.id === s.platform)?.icon} {PLATFORMS.find(p => p.id === s.platform)?.name || s.platform}
                </span>
                <StatusBadge status={s} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
