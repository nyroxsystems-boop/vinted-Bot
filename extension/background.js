/**
 * Blackruby Crosslister — Background Service Worker
 * 
 * Routes crosslist requests to the correct marketplace tab.
 * Handles tab management, retries, and status reporting.
 */

// ── Platform URL mapping ─────────────────────────────────────────────────────

const PLATFORM_URLS = {
  vinted:         'https://www.vinted.de/items/new',
  ebay_de:        'https://www.ebay.de/sell/create',
  ebay_uk:        'https://www.ebay.co.uk/sell/create',
  kleinanzeigen:  'https://www.kleinanzeigen.de/m-meine-anzeigen-aufgeben.html',
  depop:          'https://www.depop.com/products/create/',
  etsy:           'https://www.etsy.com/your/shops/me/tools/listings/create',
  grailed:        'https://www.grailed.com/sell',
  wallapop:       'https://es.wallapop.com/app/catalog/upload',
  mercari:        'https://www.mercari.com/sell/',
  fb_marketplace: 'https://www.facebook.com/marketplace/create/item',
  poshmark:       'https://poshmark.com/create-listing',
};

// ── State ────────────────────────────────────────────────────────────────────

const activeJobs = new Map(); // requestId → { platform, status, tabId }

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Single platform crosslist
  if (message.type === 'CROSSLIST_REQUEST') {
    handleCrosslistRequest(message, sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  // Bulk crosslist (multiple platforms)
  if (message.type === 'CROSSLIST_BULK') {
    handleBulkCrosslist(message, sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Status update from a platform content script
  if (message.type === 'CROSSLIST_STATUS' || message.type === 'CROSSLIST_COMPLETE') {
    // Forward to bridge (dashboard)
    forwardToDashboard(message);
    sendResponse({ received: true });
    return true;
  }
});

// ── Core: Handle single crosslist ────────────────────────────────────────────

async function handleCrosslistRequest(message) {
  const { platform, listingData, requestId } = message;
  const url = PLATFORM_URLS[platform];

  if (!url) {
    return { success: false, error: `Unknown platform: ${platform}` };
  }

  console.log(`[BG] Crosslisting to ${platform}`, { requestId });

  // Track job
  activeJobs.set(requestId, { platform, status: 'opening_tab', tabId: null });

  try {
    // Open the marketplace listing creation page
    const tab = await chrome.tabs.create({ url, active: false });
    activeJobs.get(requestId).tabId = tab.id;

    // Wait for page to load
    await waitForTabLoad(tab.id);

    // Inject the listing data via DOM attribute (eBayOS pattern — works across JS worlds)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectCrosslistData,
      args: [JSON.stringify({ listingData, requestId, platform })],
    });

    return { success: true, tabId: tab.id, platform };
  } catch (err) {
    console.error(`[BG] Crosslist to ${platform} failed:`, err);
    activeJobs.delete(requestId);
    return { success: false, error: err.message };
  }
}

// ── Bulk crosslist ───────────────────────────────────────────────────────────

async function handleBulkCrosslist(message) {
  const { platforms, listingData, requestId } = message;
  const results = {};

  for (const platform of platforms) {
    try {
      const result = await handleCrosslistRequest({
        platform,
        listingData,
        requestId: `${requestId}_${platform}`,
      });
      results[platform] = result;

      // Stagger tab opens to avoid rate limiting (human-like pattern from PoshmarkNursery)
      await delay(1500 + Math.random() * 1000);
    } catch (err) {
      results[platform] = { success: false, error: err.message };
    }
  }

  return { success: true, results };
}

// ── Helper: Inject data into page via DOM attribute ──────────────────────────
// This is the key insight from eBayOS — DOM attributes are shared across
// all JS worlds (page, content script, injected), unlike window variables.

function injectCrosslistData(dataStr) {
  document.documentElement.setAttribute('data-blackruby-crosslist', dataStr);
}

// ── Helper: Wait for tab to finish loading ───────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds

    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Tab was closed'));
          return;
        }
        if (tab.status === 'complete') {
          // Extra delay for SPA frameworks to mount
          setTimeout(resolve, 2000);
          return;
        }
        if (++attempts > maxAttempts) {
          reject(new Error('Tab load timeout'));
          return;
        }
        setTimeout(check, 500);
      });
    };
    check();
  });
}

// ── Helper: Forward messages to dashboard tab ────────────────────────────────

async function forwardToDashboard(message) {
  const tabs = await chrome.tabs.query({
    url: ['*://localhost/*', '*://127.0.0.1/*'],
  });

  for (const tab of tabs) {
    try {
      chrome.tabs.sendMessage(tab.id, message);
    } catch { /* tab might not have bridge */ }
  }
}

// ── Helper: Human-like delay (from PoshmarkNursery pattern) ──────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Extension install/update handler ─────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[BG] Blackruby Crosslister installed/updated', details.reason);

  // Set default settings
  chrome.storage.local.set({
    dashboardUrl: 'http://localhost:5173',
    autoClose: false,
    humanDelay: true,
    humanDelayMin: 800,
    humanDelayMax: 2500,
  });
});
