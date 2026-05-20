/**
 * Blackruby Crosslister — Shared Platform Utilities
 * 
 * Common functions used by all marketplace content scripts:
 * - DOM attribute watcher (from eBayOS MutationObserver pattern)
 * - Form filling with Vue/React compatibility
 * - Human-like delays (from PoshmarkNursery)
 * - Image upload helpers
 * - Status reporting
 */

// ── Core: Watch for crosslist data via DOM attribute ─────────────────────────
// This is the key pattern from eBayOS — shared across all JS execution worlds.

function watchForCrosslistData(callback) {
  const observer = new MutationObserver(() => {
    const dataStr = document.documentElement.getAttribute('data-blackruby-crosslist');
    if (dataStr) {
      document.documentElement.removeAttribute('data-blackruby-crosslist');
      console.log(`[CROSSLIST] Data received via DOM attribute`);
      try {
        const data = JSON.parse(dataStr);
        callback(data);
      } catch (e) {
        console.error('[CROSSLIST] Invalid JSON in attribute:', e);
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-blackruby-crosslist'],
  });

  return observer;
}

// ── Fallback: chrome.runtime.onMessage ────────────────────────────────────────

function listenForCrosslistMessage(callback) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'START_CROSSLIST') {
      callback(message.data || message);
      sendResponse({ success: true });
    }
    return true;
  });
}

// ── Form filling (Vue/React-compatible) ──────────────────────────────────────
// Uses native prototype setter so Vue/React reactivity picks up changes.

function setInputValue(input, value) {
  if (!input) return false;

  const proto = input.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }

  // Fire all events frameworks might listen to
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));

  return true;
}

// ── Click with human-like behavior ───────────────────────────────────────────

function humanClick(element) {
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.focus();
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
}

// ── Wait for selector ────────────────────────────────────────────────────────

function waitForSelector(selector, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Selector "${selector}" not found within ${timeout}ms`));
    }, timeout);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ── Human-like delays (pattern from PoshmarkNursery) ─────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(min = 800, max = 2500) {
  const ms = min + Math.random() * (max - min);
  return delay(ms);
}

// Small jitter between form fields
function fieldDelay() {
  return humanDelay(300, 800);
}

// ── Image download + upload ──────────────────────────────────────────────────

async function downloadImageAsFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const filename = url.split('/').pop()?.split('?')[0] || 'image.jpg';
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  } catch (err) {
    // Fallback: CORS proxy
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    const blob = await response.blob();
    return new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
  }
}

async function uploadImagesToInput(fileInput, imageUrls, max = 10) {
  const urls = imageUrls.slice(0, max);
  const files = [];

  for (const url of urls) {
    try {
      const file = await downloadImageAsFile(url);
      files.push(file);
      await delay(500);
    } catch (err) {
      console.warn('[CROSSLIST] Image download failed:', url, err.message);
    }
  }

  if (files.length === 0) return false;

  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}

// ── Status reporting ─────────────────────────────────────────────────────────

function sendStatus(platform, status, message) {
  try {
    chrome.runtime.sendMessage({
      type: 'CROSSLIST_STATUS',
      platform,
      data: { status, message, timestamp: Date.now() },
    });
  } catch { /* extension might have been reloaded */ }
}

function sendComplete(platform, success, details = {}) {
  try {
    chrome.runtime.sendMessage({
      type: 'CROSSLIST_COMPLETE',
      platform,
      data: { success, ...details, timestamp: Date.now() },
    });
  } catch { /* ignore */ }
}

// ── Concurrency guard ────────────────────────────────────────────────────────

function createGuard(platformName) {
  const key = `__blackruby_${platformName}_processing`;
  return {
    acquire() {
      if (window[key]) return false;
      window[key] = true;
      return true;
    },
    release() {
      window[key] = false;
    },
  };
}
