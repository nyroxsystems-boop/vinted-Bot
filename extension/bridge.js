/**
 * Blackruby Crosslister — Bridge Content Script
 * 
 * Injected into the Dashboard (localhost). Provides the communication channel
 * between the React dashboard and the Chrome Extension background worker.
 * 
 * Pattern adapted from eBayOS (MIT License):
 *   Dashboard ←→ Bridge (postMessage) ←→ Background ←→ Platform Content Scripts
 */

console.log('[BRIDGE] Blackruby Crosslister bridge loaded', {
  extensionId: chrome.runtime.id,
  url: window.location.href,
});

// ── Expose extension ID to dashboard ─────────────────────────────────────────

try {
  const extensionId = chrome.runtime.id;

  // sessionStorage is shared with the page — dashboard can detect extension sync
  sessionStorage.setItem('BlackrubyCrosslisterId', extensionId);
  sessionStorage.setItem('BlackrubyBridgeReady', '1');

  // Also notify via postMessage for React event listeners
  window.postMessage({
    type: 'CROSSLISTER_READY',
    extensionId,
    platforms: [
      'vinted', 'ebay_de', 'ebay_uk', 'kleinanzeigen',
      'depop', 'etsy', 'grailed', 'wallapop',
      'mercari', 'fb_marketplace', 'poshmark',
    ],
  }, '*');
} catch (err) {
  console.error('[BRIDGE] Init error:', err.message);
}

// ── Dashboard → Extension messaging ─────────────────────────────────────────

window.addEventListener('message', (event) => {
  // Respond to pings so dashboard can detect extension after mount
  if (event.data?.type === 'CROSSLISTER_PING') {
    window.postMessage({
      type: 'CROSSLISTER_READY',
      extensionId: chrome.runtime.id,
    }, '*');
    return;
  }

  // Only accept from same origin
  if (event.origin !== window.location.origin) return;

  // Forward crosslist requests to background
  if (event.data?.type === 'CROSSLIST_REQUEST') {
    if (!chrome.runtime?.id) {
      window.postMessage({
        type: 'CROSSLIST_RESPONSE',
        requestId: event.data.requestId,
        response: { success: false, error: 'Extension reloaded — refresh page.' },
      }, window.location.origin);
      return;
    }

    console.log('[BRIDGE] Forwarding crosslist request', {
      platform: event.data.platform,
      requestId: event.data.requestId,
    });

    chrome.runtime.sendMessage({
      type: 'CROSSLIST_REQUEST',
      platform: event.data.platform,
      listingData: event.data.listingData,
      requestId: event.data.requestId,
    }, (response) => {
      window.postMessage({
        type: 'CROSSLIST_RESPONSE',
        requestId: event.data.requestId,
        response: response || { success: false, error: chrome.runtime.lastError?.message },
      }, window.location.origin);
    });
  }

  // Forward bulk crosslist (all platforms at once)
  if (event.data?.type === 'CROSSLIST_BULK') {
    chrome.runtime.sendMessage({
      type: 'CROSSLIST_BULK',
      platforms: event.data.platforms,
      listingData: event.data.listingData,
      requestId: event.data.requestId,
    }, (response) => {
      window.postMessage({
        type: 'CROSSLIST_RESPONSE',
        requestId: event.data.requestId,
        response,
      }, window.location.origin);
    });
  }
});

// ── Background → Dashboard forwarding ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Forward status updates from platform scripts to the dashboard
  window.postMessage({
    type: 'CROSSLIST_STATUS',
    ...message,
  }, window.location.origin);

  sendResponse({ received: true });
  return true;
});
