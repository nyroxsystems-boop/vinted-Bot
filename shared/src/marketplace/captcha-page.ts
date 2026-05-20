// ──────────────────────────────────────────────────────────────────────────────
// CAPTCHA-Page-Helper
//
// Wraps the abstract solveCaptcha() with Playwright DOM operations:
//   1. Detect captcha element on the current page (hCaptcha / reCAPTCHA / Turnstile)
//   2. Extract sitekey from the iframe URL or data attribute
//   3. Solve via 2captcha/capmonster
//   4. Inject the token into the textarea (the standard pattern for all 3)
//   5. Optionally trigger the callback so the page-side script proceeds
//
// Returns { solved, blocked? } — caller decides whether to retry or abort.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger } from '../logger.js';
import { solveCaptcha, type CaptchaSolveRequest } from './captcha.js';
import { solveAudioCaptcha, isWhisperAvailableAsync } from './captcha-audio.js';
import { getDb, getSetting } from '../db.js';

const log = createLogger('captcha-page');

interface DetectedCaptcha {
  type: 'recaptcha-v2' | 'hcaptcha' | 'turnstile';
  siteKey: string;
}

/** Scan the page for any of the supported captcha widgets. */
export async function detectCaptcha(page: Page): Promise<DetectedCaptcha | null> {
  // hCaptcha — has iframe with data-hcaptcha-widget-id
  const hc = await page.evaluate(() => {
    const el = document.querySelector('[data-sitekey][data-hcaptcha-widget-id], iframe[src*="hcaptcha.com"]');
    if (!el) return null;
    const sk = el.getAttribute('data-sitekey') ?? new URLSearchParams(el.getAttribute('src') ?? '').get('sitekey');
    return sk ? { type: 'hcaptcha', siteKey: sk } : null;
  }).catch(() => null);
  if (hc) return hc as DetectedCaptcha;

  // reCAPTCHA v2 — div with g-recaptcha class
  const rc = await page.evaluate(() => {
    const el = document.querySelector('.g-recaptcha[data-sitekey], iframe[src*="google.com/recaptcha"]');
    if (!el) return null;
    const sk = el.getAttribute('data-sitekey');
    if (sk) return { type: 'recaptcha-v2', siteKey: sk };
    const src = el.getAttribute('src') ?? '';
    const m = src.match(/[?&]k=([^&]+)/);
    return m && m[1] ? { type: 'recaptcha-v2', siteKey: m[1] } : null;
  }).catch(() => null);
  if (rc) return rc as DetectedCaptcha;

  // Cloudflare Turnstile
  const ts = await page.evaluate(() => {
    const el = document.querySelector('.cf-turnstile[data-sitekey], iframe[src*="challenges.cloudflare.com"]');
    if (!el) return null;
    const sk = el.getAttribute('data-sitekey');
    return sk ? { type: 'turnstile', siteKey: sk } : null;
  }).catch(() => null);
  if (ts) return ts as DetectedCaptcha;

  return null;
}

/** Detect → solve → inject. Returns true if captcha was present AND solved. */
export async function detectAndSolveCaptcha(page: Page): Promise<{
  detected: boolean;
  solved: boolean;
  error?: string;
}> {
  const det = await detectCaptcha(page);
  if (!det) return { detected: false, solved: false };

  log.warn('Captcha detected on page', { type: det.type, siteKey: det.siteKey });

  // Try the free Whisper audio-solver first (if installed). This is 0€ and
  // works for reCAPTCHA + hCaptcha (both have audio accessibility option).
  // Turnstile has no audio fallback.
  if ((det.type === 'recaptcha-v2' || det.type === 'hcaptcha') && await isWhisperAvailableAsync()) {
    log.info('Trying Whisper audio-solver (free)');
    const audioBtn = det.type === 'recaptcha-v2'
      ? 'button#recaptcha-audio-button, button[aria-labelledby*="audio"]'
      : 'a[aria-label*="audio" i], button[aria-label*="audio" i]';
    try {
      const found = await page.evaluate((sel) => !!document.querySelector(sel), audioBtn);
      if (found) {
        await page.click(audioBtn).catch(() => {});
        await page.waitForTimeout(2000);
        const audioSel = 'audio#audio-source, audio source, audio[src]';
        const answerSel = det.type === 'recaptcha-v2'
          ? 'input#audio-response, input[aria-labelledby*="audio"]'
          : 'input[type="text"][aria-label*="audio" i]';
        const submitSel = det.type === 'recaptcha-v2'
          ? 'button#recaptcha-verify-button'
          : 'button[type="submit"]';
        const a = await solveAudioCaptcha(page, audioSel, answerSel, submitSel);
        if (a.solved) {
          log.info('Audio captcha solved via Whisper');
          return { detected: true, solved: true };
        }
        log.info('Whisper audio-solve did not succeed', { error: a.error });
      }
    } catch (err) {
      log.debug('Audio path attempt failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const provider = getSetting('captcha_provider') ?? 'manual';
  if (provider === 'manual' || !process.env.CAPTCHA_API_KEY) {
    if (getSetting('captcha_auto_pause_on_detect') === 'true') {
      getDb()
        .prepare(`INSERT INTO settings(key, value) VALUES ('paused', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'`)
        .run();
      getDb()
        .prepare(`INSERT INTO settings(key, value) VALUES ('captcha_last_alert', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run();
      log.warn('Captcha detected — system paused. Resume via Dashboard after solving.');
    }
    return { detected: true, solved: false, error: 'manual mode / no api key' };
  }

  const req: CaptchaSolveRequest = {
    type: det.type,
    siteKey: det.siteKey,
    pageUrl: page.url(),
  };
  const result = await solveCaptcha(req);
  if (!result.solved || !result.token) {
    log.warn('Captcha solve failed', { type: det.type, error: result.error });
    if (getSetting('captcha_auto_pause_on_detect') === 'true') {
      getDb()
        .prepare(`INSERT INTO settings(key, value) VALUES ('paused', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'`)
        .run();
      getDb()
        .prepare(`INSERT INTO settings(key, value) VALUES ('captcha_last_alert', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run();
      log.warn('Captcha solve failed — system auto-paused');
    }
    return { detected: true, solved: false, error: result.error };
  }

  // Inject the token. All 3 providers use the standard "g-recaptcha-response"
  // hidden textarea (yes, hCaptcha and Turnstile mirror this convention).
  try {
    await page.evaluate((token) => {
      const textareas = document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], textarea[name="cf-turnstile-response"]'
      );
      textareas.forEach(t => {
        t.style.display = 'block';
        t.innerHTML = token;
        t.value = token;
      });
      // Some Vinted pages have a global callback function
      const cb = (window as unknown as { ___grecaptcha_cfg?: { clients?: unknown[] } }).___grecaptcha_cfg;
      if (cb?.clients) {
        // Try standard callbacks — best-effort, may not fire
        try {
          (window as unknown as { gtag?: unknown }).gtag;
        } catch { /* ignore */ }
      }
    }, result.token);
    log.info('Captcha solved + token injected', { type: det.type, solveTimeSec: result.solveTimeSec });
    return { detected: true, solved: true };
  } catch (err) {
    return { detected: true, solved: false, error: err instanceof Error ? err.message : String(err) };
  }
}
