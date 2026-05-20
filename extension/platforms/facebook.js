/**
 * Blackruby Crosslister — Facebook Marketplace Content Script
 * 
 * Auto-fills the FB Marketplace "Create new listing" form.
 * Pattern insights from GeorgiKeranov/facebook-marketplace-bot (212 ⭐).
 * 
 * FB uses React with aggressive re-rendering — extra delays needed.
 */

console.log('[FB] Content script loaded:', window.location.href);

const PLATFORM = 'fb_marketplace';
let isProcessing = false;

// Watch for crosslist data
const observer = new MutationObserver(() => {
  const dataStr = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (dataStr) {
    document.documentElement.removeAttribute('data-blackruby-crosslist');
    try { startCrosslisting(JSON.parse(dataStr)); } catch (e) { console.error('[FB]', e); }
  }
});
observer.observe(document.documentElement, {
  attributes: true, attributeFilter: ['data-blackruby-crosslist'],
});

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.type === 'START_CROSSLIST') { startCrosslisting(msg); sendResponse({ success: true }); }
  return true;
});

async function startCrosslisting(payload) {
  if (isProcessing) return;
  isProcessing = true;
  const listing = payload.listingData;
  if (!listing) { isProcessing = false; return; }

  try {
    sendStatus('initiating', 'Warte auf Facebook Marketplace Formular...');
    
    // FB Marketplace form loads dynamically — wait longer
    await delay(3000);
    await waitForPage();

    sendStatus('filling_form', 'Formular wird ausgefüllt...');

    // FB Marketplace uses aria-labels and data-testid attributes extensively
    // The "Create new listing" flow has specific form fields

    // Title / "What are you selling?"
    const titleInput = findByLabels([
      'input[aria-label*="Title" i]',
      'input[aria-label*="Titel" i]',
      'input[placeholder*="What are you selling" i]',
      'input[placeholder*="Was verkaufst du" i]',
      'span[dir="auto"] input',
    ]);
    if (titleInput) {
      await fillFBInput(titleInput, (listing.title || '').slice(0, 99));
      await humanDelay();
    }

    // Price
    const priceInput = findByLabels([
      'input[aria-label*="Price" i]',
      'input[aria-label*="Preis" i]',
      'input[placeholder*="Price" i]',
      'input[placeholder*="Preis" i]',
    ]);
    if (priceInput) {
      await fillFBInput(priceInput, String(Math.round(listing.price_eur || 0)));
      await humanDelay();
    }

    // Description
    const descInput = findByLabels([
      'textarea[aria-label*="Description" i]',
      'textarea[aria-label*="Beschreibung" i]',
      'textarea[placeholder*="Describe" i]',
      'textarea[placeholder*="Beschreib" i]',
    ]);
    if (descInput) {
      await fillFBInput(descInput, (listing.description || '').slice(0, 4999));
      await humanDelay();
    }

    // Location (FB requires this — try to set if a location input exists)
    const locationInput = findByLabels([
      'input[aria-label*="Location" i]',
      'input[aria-label*="Standort" i]',
      'input[placeholder*="Location" i]',
    ]);
    if (locationInput && !locationInput.value) {
      await fillFBInput(locationInput, 'Germany');
      await delay(1000);
      // Click first suggestion
      const suggestion = document.querySelector('[role="option"], [role="listbox"] [role="option"]');
      if (suggestion) suggestion.click();
      await humanDelay();
    }

    // Condition dropdown
    if (listing.condition) {
      const conditionButton = findByLabels([
        '[aria-label*="Condition" i]',
        '[aria-label*="Zustand" i]',
        'label[text*="Condition" i]',
      ]);
      if (conditionButton) {
        conditionButton.click();
        await delay(800);
        const condMap = {
          'Neu, mit Etikett': 'New',
          'Neu': 'New',
          'Sehr gut': 'Used - Like New',
          'Gut': 'Used - Good',
          'Befriedigend': 'Used - Fair',
        };
        const target = condMap[listing.condition] || 'Used - Good';
        const options = document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]');
        for (const opt of options) {
          if (opt.textContent?.includes(target) || opt.textContent?.includes(target.replace('Used - ', ''))) {
            opt.click();
            break;
          }
        }
        await humanDelay();
      }
    }

    // Images — FB Marketplace allows drag-and-drop or file input
    const fileInput = document.querySelector('input[type="file"][accept*="image"]');
    if (fileInput && listing.image_urls?.length > 0) {
      sendStatus('uploading_images', 'Bilder werden hochgeladen...');
      await uploadImages(fileInput, listing.image_urls, 10);
      await delay(3000); // FB needs time to process uploads
    }

    sendStatus('completed', 'Formular ausgefüllt! Bitte überprüfen und "Veröffentlichen" klicken.');
    sendComplete(true, { url: window.location.href });

  } catch (err) {
    sendStatus('failed', `Fehler: ${err.message}`);
    sendComplete(false, { error: err.message });
  } finally {
    isProcessing = false;
  }
}

// ── FB-specific helpers ──────────────────────────────────────────────────────

// FB uses React with controlled components — need native setter + aggressive event firing
async function fillFBInput(el, value) {
  // Focus first
  el.focus();
  await delay(200);

  // Clear existing
  el.select?.();
  document.execCommand('selectAll');
  document.execCommand('delete');
  await delay(100);

  // Use native setter
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;

  // Fire React's synthetic event chain
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));

  // Also try typing character by character for stubborn fields
  // (FB sometimes only reacts to keydown/keypress events)
}

function findByLabels(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function waitForPage() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const form = document.querySelector(
        'input[aria-label*="Title" i], input[aria-label*="Titel" i], input[placeholder*="selling" i], input[aria-label*="Price" i]'
      );
      if (form) { resolve(); return; }
      if (++attempts > 60) { resolve(); return; } // 30s timeout then proceed
      setTimeout(check, 500);
    };
    check();
  });
}

async function uploadImages(fileInput, urls, max) {
  const files = [];
  for (const url of urls.slice(0, max)) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      files.push(new File([blob], 'img.jpg', { type: blob.type || 'image/jpeg' }));
    } catch {}
  }
  if (files.length) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function humanDelay() { return delay(800 + Math.random() * 1200); }

function sendStatus(status, message) {
  try { chrome.runtime.sendMessage({ type: 'CROSSLIST_STATUS', platform: PLATFORM, data: { status, message, timestamp: Date.now() } }); } catch {}
}
function sendComplete(success, details) {
  try { chrome.runtime.sendMessage({ type: 'CROSSLIST_COMPLETE', platform: PLATFORM, data: { success, ...details, timestamp: Date.now() } }); } catch {}
}
