/**
 * Blackruby Crosslister — Vinted Content Script
 * 
 * Auto-fills the Vinted "Neuer Artikel" listing form.
 * Vinted uses Vue.js with reactive form fields.
 */

console.log('[VINTED] Content script loaded:', window.location.href);
const PLATFORM = 'vinted';
let isProcessing = false;

const observer = new MutationObserver(() => {
  const dataStr = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (dataStr) {
    document.documentElement.removeAttribute('data-blackruby-crosslist');
    try { startCrosslisting(JSON.parse(dataStr)); } catch (e) { console.error('[VINTED]', e); }
  }
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackruby-crosslist'] });

chrome.runtime.onMessage.addListener((msg, _, sr) => {
  if (msg.type === 'START_CROSSLIST') { startCrosslisting(msg); sr({ success: true }); }
  return true;
});

async function startCrosslisting(payload) {
  if (isProcessing) return;
  isProcessing = true;
  const d = payload.listingData;
  if (!d) { isProcessing = false; return; }

  try {
    sendStatus('initiating', 'Warte auf Vinted-Formular...');
    await waitFor('input[data-testid*="title"], #title, input[name*="title"]');

    sendStatus('filling_form', 'Formular wird ausgefüllt...');

    fill('input[data-testid*="title"], #title, input[name*="title"]', (d.title || '').slice(0, 80));
    await fd();
    fill('textarea[data-testid*="description"], #description, textarea[name*="description"]', d.description || '');
    await fd();
    fill('input[data-testid*="price"], #price, input[name*="price"]', String(d.price_eur || 0));
    await fd();

    // Brand
    const brandInput = qs('input[data-testid*="brand"], input[placeholder*="Marke" i]');
    if (brandInput && d.brand) {
      fillEl(brandInput, d.brand);
      await delay(800);
      const sug = qs('[data-testid*="suggestion"], [role="option"]');
      if (sug) sug.click();
    }

    // Images
    const fi = qs('input[type="file"]');
    if (fi && d.image_urls?.length) {
      sendStatus('uploading_images', 'Bilder hochladen...');
      await uploadImgs(fi, d.image_urls, 20);
      await delay(2000);
    }

    sendStatus('completed', 'Formular ausgefüllt! Bitte prüfen und senden.');
    sendComplete(true);
  } catch (err) {
    sendStatus('failed', err.message);
    sendComplete(false, { error: err.message });
  } finally { isProcessing = false; }
}

function qs(s) { return document.querySelector(s); }
function fill(sel, val) { const el = qs(sel); if (el) fillEl(el, val); }
function fillEl(el, val) {
  const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const s = Object.getOwnPropertyDescriptor(p, 'value')?.set;
  if (s) s.call(el, val); else el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function waitFor(sel, t = 20000) {
  return new Promise((res) => { let a = 0; const c = () => { if (qs(sel) || ++a > t/500) { res(); return; } setTimeout(c, 500); }; c(); });
}
async function uploadImgs(fi, urls, max) {
  const files = [];
  for (const u of urls.slice(0, max)) { try { const r = await fetch(u); const b = await r.blob(); files.push(new File([b], 'i.jpg', { type: b.type || 'image/jpeg' })); } catch {} }
  if (files.length) { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); fi.files = dt.files; fi.dispatchEvent(new Event('change', { bubbles: true })); }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fd() { return delay(300 + Math.random() * 500); }
function sendStatus(s, m) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_STATUS', platform: PLATFORM, data: { status: s, message: m, timestamp: Date.now() } }); } catch {} }
function sendComplete(ok, d) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_COMPLETE', platform: PLATFORM, data: { success: ok, ...d, timestamp: Date.now() } }); } catch {} }
