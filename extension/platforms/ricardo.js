// Blackruby Crosslister — Ricardo (CH) Content Script
console.log('[RICARDO] Loaded:', window.location.href);
const PLATFORM = 'ricardo';
let busy = false;
const obs = new MutationObserver(() => { const d = document.documentElement.getAttribute('data-blackruby-crosslist'); if(d) { document.documentElement.removeAttribute('data-blackruby-crosslist'); try{go(JSON.parse(d));}catch{} } });
obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-blackruby-crosslist'] });
chrome.runtime.onMessage.addListener((m,_,sr)=>{ if(m.type==='START_CROSSLIST'){go(m);sr({ok:true});} return true; });
async function go(p) {
  if(busy)return; busy=true; const d=p.listingData; if(!d){busy=false;return;}
  try {
    await waitFor('input[name="title"], input[placeholder*="Titel" i], input[name*="title" i]');
    // CHF conversion (approx 1 EUR = 0.95 CHF)
    const chfPrice = Math.round((d.price_eur||0) * 0.95);
    fill('input[name="title"], input[placeholder*="Titel" i], input[name*="title" i]', (d.title||'').slice(0,80));
    await dl(500);
    fill('textarea[name="description"], textarea[placeholder*="Beschreibung" i]', d.description||'');
    await dl(500);
    fill('input[name="price"], input[placeholder*="Preis" i], input[name*="price" i]', String(chfPrice));
    await dl(500);
    const fi=document.querySelector('input[type="file"]');
    if(fi&&d.image_urls?.length){await upImg(fi,d.image_urls,10);await dl(2000);}
    msg('CROSSLIST_COMPLETE',{success:true});
  } catch(e){msg('CROSSLIST_COMPLETE',{success:false,error:e.message});}
  finally{busy=false;}
}
function qs(s){for(const x of s.split(',')){const e=document.querySelector(x.trim());if(e)return e;}return null;}
function fill(sel,val){const el=qs(sel);if(el)fv(el,val);}
function fv(el,v){const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(el,v);else el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
function waitFor(s,t=20000){return new Promise(r=>{let a=0;const c=()=>{if(qs(s)||++a>t/500)r();else setTimeout(c,500);};c();});}
async function upImg(fi,urls,m){const f=[];for(const u of urls.slice(0,m)){try{const r=await fetch(u);const b=await r.blob();f.push(new File([b],'i.jpg',{type:b.type||'image/jpeg'}));}catch{}}if(f.length){const dt=new DataTransfer();f.forEach(x=>dt.items.add(x));fi.files=dt.files;fi.dispatchEvent(new Event('change',{bubbles:true}));}}
function dl(ms){return new Promise(r=>setTimeout(r,ms));}
function msg(t,d){try{chrome.runtime.sendMessage({type:t,platform:PLATFORM,data:{...d,timestamp:Date.now()}});}catch{}}
