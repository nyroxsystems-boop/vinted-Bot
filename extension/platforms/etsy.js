/**
 * Blackruby Crosslister — Etsy Content Script
 * Auto-fills Etsy listing creation form.
 */
console.log('[ETSY] Content script loaded:', window.location.href);
const PLATFORM = 'etsy';
let isProcessing = false;

const observer = new MutationObserver(() => {
  const d = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (d) { document.documentElement.removeAttribute('data-blackruby-crosslist'); try { start(JSON.parse(d)); } catch(e) { console.error('[ETSY]', e); } }
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackruby-crosslist'] });
chrome.runtime.onMessage.addListener((m, _, sr) => { if (m.type === 'START_CROSSLIST') { start(m); sr({ success: true }); } return true; });

async function start(payload) {
  if (isProcessing) return;
  isProcessing = true;
  const d = payload.listingData;
  if (!d) { isProcessing = false; return; }

  try {
    ss('initiating', 'Waiting for Etsy form...');
    await waitFor('input[name="title"], #listing-edit-title, input[placeholder*="title" i]');
    ss('filling_form', 'Filling listing form...');

    fill('input[name="title"], #listing-edit-title', (d.title || '').slice(0, 140));
    await fd();

    // Etsy description — can be contenteditable div or textarea
    const descEl = qs('div[contenteditable="true"][role="textbox"], textarea[name="description"], #description-text-area-input');
    if (descEl) {
      if (descEl.getAttribute('contenteditable')) {
        descEl.innerHTML = (d.description || '').replace(/\n/g, '<br>');
        descEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        fillEl(descEl, d.description || '');
      }
    }
    await fd();

    // Price
    fill('input[name="price"], input[aria-label*="Price" i], #price-input', String(d.price_eur || 0));
    await fd();

    // Tags (Etsy allows 13 tags)
    const tagInput = qs('input[name*="tag"], input[placeholder*="tag" i], #tag-input');
    if (tagInput && d.tags) {
      const tags = typeof d.tags === 'string' ? d.tags.split(',') : (d.tags || []);
      for (const tag of tags.slice(0, 13)) {
        fillEl(tagInput, tag.trim());
        await delay(200);
        tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await delay(300);
      }
    }

    // Who made it → "someone_else" for reselling
    const whoMadeSelect = qs('select[name*="who_made"], #who_made');
    if (whoMadeSelect) {
      whoMadeSelect.value = 'someone_else';
      whoMadeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Images
    const fi = qs('input[type="file"]');
    if (fi && d.image_urls?.length) {
      ss('uploading_images', 'Uploading images...');
      await uploadImgs(fi, d.image_urls, 10);
      await delay(3000);
    }

    ss('completed', 'Listing form filled! Review and publish.');
    sc(true);
  } catch (err) { ss('failed', err.message); sc(false, { error: err.message }); }
  finally { isProcessing = false; }
}

function qs(s) { for (const sel of s.split(',')) { const el = document.querySelector(sel.trim()); if (el) return el; } return null; }
function fill(sel, val) { const el = qs(sel); if (el) fillEl(el, val); }
function fillEl(el, val) { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value')?.set; if (s) s.call(el, val); else el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
function waitFor(sel, t = 20000) { return new Promise(r => { let a = 0; const c = () => { if (qs(sel) || ++a > t/500) r(); else setTimeout(c, 500); }; c(); }); }
async function uploadImgs(fi, urls, max) { const files = []; for (const u of urls.slice(0, max)) { try { const r = await fetch(u); const b = await r.blob(); files.push(new File([b], 'i.jpg', { type: b.type || 'image/jpeg' })); } catch {} } if (files.length) { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); fi.files = dt.files; fi.dispatchEvent(new Event('change', { bubbles: true })); } }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fd() { return delay(300 + Math.random() * 500); }
function ss(s, m) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_STATUS', platform: PLATFORM, data: { status: s, message: m, timestamp: Date.now() } }); } catch {} }
function sc(ok, d = {}) { try { chrome.runtime.sendMessage({ type: 'CROSSLIST_COMPLETE', platform: PLATFORM, data: { success: ok, ...d, timestamp: Date.now() } }); } catch {} }
