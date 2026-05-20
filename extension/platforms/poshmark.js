/**
 * Blackruby Crosslister — Poshmark Content Script
 * Ported from eBayOS (MIT License)
 */
console.log('[POSHMARK] Loaded:', window.location.href);
const PLATFORM = 'poshmark';
let busy = false;

const obs = new MutationObserver(() => {
  const d = document.documentElement.getAttribute('data-blackruby-crosslist');
  if (d) { document.documentElement.removeAttribute('data-blackruby-crosslist'); try { go(JSON.parse(d)); } catch(e) {} }
});
obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackruby-crosslist'] });
chrome.runtime.onMessage.addListener((m, _, sr) => { if (m.type === 'START_CROSSLIST') { go(m); sr({ ok: true }); } return true; });

async function go(p) {
  if (busy) return; busy = true;
  const d = p.listingData; if (!d) { busy = false; return; }
  try {
    await waitFor('input[type="file"]');
    const fi = qs('input[type="file"]');
    if (fi && d.image_urls?.length) { await upImg(fi, d.image_urls, 8); await dl(3000); }
    await waitFor('input[data-vv-name="title"], input[placeholder*="selling" i]', 30000);
    const ti = qs('input[data-vv-name="title"], input[placeholder*="selling" i]');
    if (ti) { fv(ti, (d.title || '').replace(/NWT/gi,'').trim().slice(0,80)); await dl(500); }
    if (d.brand) { const b = qs('input[placeholder="Enter the Brand/Designer"]'); if (b) { fv(b, d.brand); await dl(500); } }
    const pi = qs('input[data-vv-name="listingPrice"]');
    if (pi) { fv(pi, String(Math.round((d.price_eur||0)*1.08*1.25))); await dl(500); }
    await dl(1000);
    const de = qs('textarea[data-vv-name="description"]');
    if (de) fv(de, (d.description||'').replace(/<[^>]*>/g,'').slice(0,1500));
    msg('CROSSLIST_COMPLETE', { success: true });
  } catch(e) { msg('CROSSLIST_COMPLETE', { success: false, error: e.message }); }
  finally { busy = false; }
}

function qs(s) { for (const x of s.split(',')) { const e = document.querySelector(x.trim()); if (e) return e; } return null; }
function fv(el, v) { const p = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p,'value')?.set; if(s) s.call(el,v); else el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
function waitFor(s, t=20000) { return new Promise(r => { let a=0; const c=()=>{ if(qs(s)||++a>t/500) r(); else setTimeout(c,500); }; c(); }); }
async function upImg(fi, urls, m) { const f=[]; for(const u of urls.slice(0,m)) { try { const r=await fetch(u); const b=await r.blob(); f.push(new File([b],'i.jpg',{type:b.type||'image/jpeg'})); } catch{} } if(f.length) { const dt=new DataTransfer(); f.forEach(x=>dt.items.add(x)); fi.files=dt.files; fi.dispatchEvent(new Event('change',{bubbles:true})); } }
function dl(ms) { return new Promise(r => setTimeout(r, ms)); }
function msg(t, d) { try { chrome.runtime.sendMessage({ type: t, platform: PLATFORM, data: { ...d, timestamp: Date.now() } }); } catch{} }
