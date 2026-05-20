/**
 * Blackruby Crosslister — eBay Content Script
 * Auto-fills eBay DE/UK "Sell your item" form.
 */

console.log('[EBAY] Content script loaded:', window.location.href);
const PLATFORM = 'ebay';
let isProcessing = false;

const observer = new MutationObserver(() => {
  const d = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (d) { document.documentElement.removeAttribute('data-blackruby-crosslist'); try { start(JSON.parse(d)); } catch(e) { console.error('[EBAY]', e); } }
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackruby-crosslist'] });
chrome.runtime.onMessage.addListener((m, _, sr) => { if (m.type === 'START_CROSSLIST') { start(m); sr({ success: true }); } return true; });

async function start(payload) {
  if (isProcessing) return;
  isProcessing = true;
  const d = payload.listingData;
  if (!d) { isProcessing = false; return; }

  try {
    ss('initiating', 'Waiting for eBay form...');
    await waitFor('input[name*="title" i], #s0-1-1-5-8-textbox, input[placeholder*="title" i]');
    ss('filling_form', 'Filling form...');

    fill('input[name*="title" i], #s0-1-1-5-8-textbox, input[placeholder*="title" i]', (d.title || '').slice(0, 80));
    await fd();

    // eBay description uses iframe or contenteditable
    const descFrame = document.querySelector('iframe[title*="description" i], iframe[id*="desc" i]');
    if (descFrame?.contentDocument) {
      const body = descFrame.contentDocument.body;
      if (body) { body.innerHTML = d.description || ''; }
    } else {
      fill('textarea[name*="description" i], [contenteditable="true"]', d.description || '');
    }
    await fd();

    // Price
    fill('input[name*="price" i], input[aria-label*="price" i], input[id*="price" i]', String(d.price_eur || 0));
    await fd();

    // Images
    const fi = qs('input[type="file"]');
    if (fi && d.image_urls?.length) {
      ss('uploading_images', 'Uploading images...');
      await uploadImgs(fi, d.image_urls, 12);
      await delay(3000);
    }

    ss('completed', 'Form filled! Review and list.');
    sc(true);
  } catch (err) { ss('failed', err.message); sc(false, { error: err.message }); }
  finally { isProcessing = false; }
}

function qs(s) { for (const sel of s.split(',')) { const el = document.querySelector(sel.trim()); if (el) return el; } return null; }
function fill(sel, val) { const el = qs(sel); if (el) { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value')?.set; if (s) s.call(el, val); else el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }
function waitFor(sel, t = 20000) { return new Promise(r => { let a = 0; const c = () => { if (qs(sel) || ++a > t/500) r(); else setTimeout(c, 500); }; c(); }); }
async function uploadImgs(fi, urls, max) { const files = []; for (const u of urls.slice(0, max)) { try { const r = await fetch(u); const b = await r.blob(); files.push(new File([b], 'i.jpg', { type: b.type || 'image/jpeg' })); } catch {} } if (files.length) { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); fi.files = dt.files; fi.dispatchEvent(new Event('change', { bubbles: true })); } }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fd() { return delay(300 + Math.random() * 500); }
function ss(s, m) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_STATUS', platform: PLATFORM, data: { status: s, message: m, timestamp: Date.now() } }); } catch {} }
function sc(ok, d = {}) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_COMPLETE', platform: PLATFORM, data: { success: ok, ...d, timestamp: Date.now() } }); } catch {} }
