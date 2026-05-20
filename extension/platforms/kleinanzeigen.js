/**
 * Blackruby Crosslister — Kleinanzeigen.de Content Script
 * 
 * Auto-fills the "Anzeige aufgeben" form on Kleinanzeigen (formerly eBay Kleinanzeigen).
 * Uses DOM attribute injection pattern from eBayOS.
 *
 * Tested selectors: May 2026
 */

console.log('[KLEINANZEIGEN] Content script loaded:', window.location.href);

const PLATFORM = 'kleinanzeigen';
let isProcessing = false;

// ── Watch for crosslist data ─────────────────────────────────────────────────

const observer = new MutationObserver(() => {
  const dataStr = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (dataStr) {
    document.documentElement.removeAttribute('data-blackruby-crosslist');
    try {
      const data = JSON.parse(dataStr);
      startCrosslisting(data);
    } catch (e) {
      console.error('[KLEINANZEIGEN] Parse error:', e);
    }
  }
});
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-blackruby-crosslist'],
});

// Fallback: message listener
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CROSSLIST') {
    startCrosslisting(msg);
    sendResponse({ success: true });
  }
  return true;
});

// ── Main flow ────────────────────────────────────────────────────────────────

async function startCrosslisting(crosslistPayload) {
  if (isProcessing) return;
  isProcessing = true;

  const listing = crosslistPayload.listingData;
  if (!listing) {
    sendStatus('failed', 'Keine Listing-Daten erhalten');
    isProcessing = false;
    return;
  }

  try {
    sendStatus('initiating', 'Warte auf Kleinanzeigen-Formular...');
    await waitForPage();

    sendStatus('filling_form', 'Formular wird ausgefüllt...');

    // Title
    const titleInput = document.querySelector(
      '#postad-title, input[id*="title"], input[name*="title"], input[placeholder*="Titel" i]'
    );
    if (titleInput) {
      fillInput(titleInput, (listing.title || '').slice(0, 65));
      await fieldDelay();
    }

    // Category (try clicking existing category selector)
    // Kleinanzeigen uses a tree-based category picker — skip auto-fill, let user pick

    // Description
    const descInput = document.querySelector(
      '#pstad-descrptn, textarea[id*="description"], textarea[name*="description"], textarea[placeholder*="Beschreibung" i]'
    );
    if (descInput) {
      fillInput(descInput, listing.description || '');
      await fieldDelay();
    }

    // Price
    const priceInput = document.querySelector(
      '#postad-price, input[id*="price"], input[name*="price"], input[placeholder*="Preis" i]'
    );
    if (priceInput) {
      const price = listing.price_eur || listing.price || 0;
      fillInput(priceInput, String(Math.round(price)));
      await fieldDelay();
    }

    // Price type: "Festpreis" radio
    const festpreisRadio = document.querySelector(
      'input[value="FIXED"], input[name*="priceType"][value*="FIXED"], label:has(input[type="radio"]):not([class*="negotiable"])'
    );
    if (festpreisRadio) {
      festpreisRadio.click();
      await delay(300);
    }

    // Images
    const fileInput = document.querySelector('input[type="file"][accept*="image"]');
    if (fileInput && listing.image_urls?.length > 0) {
      sendStatus('uploading_images', 'Bilder werden hochgeladen...');
      await uploadImages(fileInput, listing.image_urls);
      await delay(2000);
    }

    // Condition (if dropdown exists)
    const conditionSelect = document.querySelector('select[name*="condition"]');
    if (conditionSelect && listing.condition) {
      const condMap = {
        'Neu, mit Etikett': 'new',
        'Neu': 'new',
        'Sehr gut': 'used',
        'Gut': 'used',
        'Befriedigend': 'used',
      };
      conditionSelect.value = condMap[listing.condition] || 'used';
      conditionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    sendStatus('completed', 'Formular ausgefüllt! Bitte überprüfen und absenden.');
    sendComplete(true, { url: window.location.href });

  } catch (err) {
    console.error('[KLEINANZEIGEN] Error:', err);
    sendStatus('failed', `Fehler: ${err.message}`);
    sendComplete(false, { error: err.message });
  } finally {
    isProcessing = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForPage() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const form = document.querySelector(
        '#postad-title, form[id*="postad"], input[name*="title"]'
      );
      if (form) { resolve(); return; }
      if (++attempts > 40) { resolve(); return; } // proceed anyway
      setTimeout(check, 500);
    };
    check();
  });
}

function fillInput(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function uploadImages(fileInput, urls) {
  const files = [];
  for (const url of urls.slice(0, 12)) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      files.push(new File([blob], 'img.jpg', { type: blob.type || 'image/jpeg' }));
    } catch { /* skip */ }
  }
  if (files.length) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fieldDelay() { return delay(300 + Math.random() * 500); }

function sendStatus(status, message) {
  try {
    chrome.runtime.sendMessage({
      type: 'CROSSLIST_STATUS', platform: PLATFORM,
      data: { status, message, timestamp: Date.now() },
    });
  } catch {}
}

function sendComplete(success, details) {
  try {
    chrome.runtime.sendMessage({
      type: 'CROSSLIST_COMPLETE', platform: PLATFORM,
      data: { success, ...details, timestamp: Date.now() },
    });
  } catch {}
}
