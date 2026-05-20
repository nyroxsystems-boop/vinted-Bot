/**
 * Blackruby Crosslister — Depop Content Script
 * 
 * Auto-fills the Depop listing creation page.
 * Depop uses React — requires native setter trick for input values.
 */

console.log('[DEPOP] Content script loaded:', window.location.href);

const PLATFORM = 'depop';
let isProcessing = false;

// Watch for crosslist data via DOM attribute
const observer = new MutationObserver(() => {
  const dataStr = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (dataStr) {
    document.documentElement.removeAttribute('data-blackruby-crosslist');
    try { startCrosslisting(JSON.parse(dataStr)); } catch (e) { console.error('[DEPOP]', e); }
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
    sendStatus('initiating', 'Waiting for Depop form...');
    await waitForPage();

    sendStatus('filling_form', 'Filling form fields...');

    // Description (Depop puts description first in the create flow)
    const descInput = document.querySelector(
      'textarea[name="description"], textarea[data-testid*="description"], textarea[placeholder*="Describe" i]'
    );
    if (descInput) {
      fillInput(descInput, (listing.description || '').slice(0, 1000));
      await fieldDelay();
    }

    // Price — Depop uses a specific price input
    const priceInput = document.querySelector(
      'input[name="price"], input[data-testid*="price"], input[placeholder*="Price" i], input[type="number"]'
    );
    if (priceInput) {
      const gbpPrice = (listing.price_eur || 0) * 0.86; // EUR → GBP approx
      fillInput(priceInput, Math.round(gbpPrice).toString());
      await fieldDelay();
    }

    // Brand
    const brandInput = document.querySelector(
      'input[name="brand"], input[data-testid*="brand"], input[placeholder*="Brand" i]'
    );
    if (brandInput && listing.brand) {
      fillInput(brandInput, listing.brand);
      await delay(500);
      // Try clicking first autocomplete suggestion
      setTimeout(() => {
        const suggestion = document.querySelector('[role="option"], [data-testid*="suggestion"]');
        if (suggestion) suggestion.click();
      }, 800);
      await fieldDelay();
    }

    // Condition — Depop uses buttons/dropdown
    if (listing.condition) {
      const condMap = {
        'Neu, mit Etikett': 'Brand new',
        'Neu': 'Brand new',
        'Sehr gut': 'Like new',
        'Gut': 'Good',
        'Befriedigend': 'Fair',
      };
      const targetCond = condMap[listing.condition] || 'Good';
      const condButtons = document.querySelectorAll('button, [role="radio"], [role="option"]');
      for (const btn of condButtons) {
        if (btn.textContent?.trim().toLowerCase().includes(targetCond.toLowerCase())) {
          btn.click();
          break;
        }
      }
      await fieldDelay();
    }

    // Color
    if (listing.colors?.length) {
      const colorInput = document.querySelector('input[placeholder*="Colour" i], input[name*="color" i]');
      if (colorInput) {
        // Map German → English colors
        const colorMap = { 'Schwarz': 'Black', 'Weiß': 'White', 'Blau': 'Blue', 'Rot': 'Red', 'Grün': 'Green', 'Grau': 'Grey', 'Braun': 'Brown', 'Rosa': 'Pink', 'Beige': 'Beige', 'Gelb': 'Yellow' };
        fillInput(colorInput, colorMap[listing.colors[0]] || listing.colors[0]);
        await fieldDelay();
      }
    }

    // Images
    const fileInput = document.querySelector('input[type="file"][accept*="image"]');
    if (fileInput && listing.image_urls?.length > 0) {
      sendStatus('uploading_images', 'Uploading images...');
      await uploadImages(fileInput, listing.image_urls, 4);
      await delay(2000);
    }

    sendStatus('completed', 'Form filled! Please review and post.');
    sendComplete(true, { url: window.location.href });

  } catch (err) {
    sendStatus('failed', `Error: ${err.message}`);
    sendComplete(false, { error: err.message });
  } finally {
    isProcessing = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForPage() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      if (document.querySelector('textarea, input[name="price"], form')) { resolve(); return; }
      if (++attempts > 40) { resolve(); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function fillInput(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
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
function fieldDelay() { return delay(300 + Math.random() * 500); }

function sendStatus(status, message) {
  try { chrome.runtime.sendMessage({ type: 'CROSSLIST_STATUS', platform: PLATFORM, data: { status, message, timestamp: Date.now() } }); } catch {}
}
function sendComplete(success, details) {
  try { chrome.runtime.sendMessage({ type: 'CROSSLIST_COMPLETE', platform: PLATFORM, data: { success, ...details, timestamp: Date.now() } }); } catch {}
}
