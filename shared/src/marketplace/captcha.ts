// ──────────────────────────────────────────────────────────────────────────────
// Captcha-Hub
//
// Pluggable Solver. Ohne API-Key → manueller Modus (Bot pausiert + Alert).
// Konfiguriert über ENV:
//   CAPTCHA_PROVIDER=2captcha | capmonster | manual
//   CAPTCHA_API_KEY=...
//
// Im Bot-Code:
//   const result = await solveCaptchaIfPresent(page, { siteKey, url });
//   if (!result.solved) await onManualBlock(); // pause + SSE-alert
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from '../logger.js';

const log = createLogger('captcha');

export type CaptchaProvider = '2captcha' | 'capmonster' | 'manual';

export interface CaptchaSolveRequest {
  type: 'recaptcha-v2' | 'recaptcha-v3' | 'hcaptcha' | 'turnstile';
  siteKey: string;
  pageUrl: string;
  /** Für reCAPTCHA v3 */
  action?: string;
  minScore?: number;
}

export interface CaptchaSolveResult {
  solved: boolean;
  token?: string;
  error?: string;
  provider: CaptchaProvider;
  /** Sekunden bis Lösung. */
  solveTimeSec?: number;
}

const CAPTCHA_PROVIDER = (process.env.CAPTCHA_PROVIDER ?? 'manual') as CaptchaProvider;
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY ?? '';

export async function solveCaptcha(req: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
  if (CAPTCHA_PROVIDER === 'manual' || !CAPTCHA_API_KEY) {
    log.warn('Captcha encountered, manual mode — bot pauses', req);
    return { solved: false, provider: 'manual', error: 'manual-mode' };
  }
  if (CAPTCHA_PROVIDER === '2captcha') return solve2Captcha(req);
  if (CAPTCHA_PROVIDER === 'capmonster') return solveCapMonster(req);
  return { solved: false, provider: CAPTCHA_PROVIDER, error: `unknown provider ${CAPTCHA_PROVIDER}` };
}

async function solve2Captcha(req: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
  const start = Date.now();
  try {
    const submit = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        key: CAPTCHA_API_KEY,
        method: req.type === 'hcaptcha' ? 'hcaptcha' : req.type === 'turnstile' ? 'turnstile' : 'userrecaptcha',
        sitekey: req.siteKey,
        pageurl: req.pageUrl,
        json: '1',
        ...(req.type === 'recaptcha-v3' ? { version: 'v3', action: req.action ?? 'verify', min_score: String(req.minScore ?? 0.3) } : {}),
      }),
    });
    const submitJson = (await submit.json()) as { status: number; request: string };
    if (submitJson.status !== 1) return { solved: false, provider: '2captcha', error: `submit: ${submitJson.request}` };
    const taskId = submitJson.request;

    // Poll bis 180s
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const poll = await fetch(`https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=get&id=${taskId}&json=1`);
      const pj = (await poll.json()) as { status: number; request: string };
      if (pj.status === 1) {
        return { solved: true, token: pj.request, provider: '2captcha', solveTimeSec: Math.round((Date.now() - start) / 1000) };
      }
      if (pj.request !== 'CAPCHA_NOT_READY') return { solved: false, provider: '2captcha', error: pj.request };
    }
    return { solved: false, provider: '2captcha', error: 'timeout' };
  } catch (err) {
    return { solved: false, provider: '2captcha', error: err instanceof Error ? err.message : String(err) };
  }
}

async function solveCapMonster(req: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
  const start = Date.now();
  try {
    const taskType = req.type === 'hcaptcha' ? 'HCaptchaTaskProxyless'
      : req.type === 'turnstile' ? 'TurnstileTaskProxyless'
      : req.type === 'recaptcha-v3' ? 'RecaptchaV3TaskProxyless'
      : 'RecaptchaV2TaskProxyless';
    const create = await fetch('https://api.capmonster.cloud/createTask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientKey: CAPTCHA_API_KEY,
        task: {
          type: taskType,
          websiteURL: req.pageUrl,
          websiteKey: req.siteKey,
          ...(req.type === 'recaptcha-v3' ? { pageAction: req.action ?? 'verify', minScore: req.minScore ?? 0.3 } : {}),
        },
      }),
    });
    const cj = (await create.json()) as { errorId?: number; taskId?: number; errorDescription?: string };
    if (cj.errorId !== 0 || !cj.taskId) return { solved: false, provider: 'capmonster', error: cj.errorDescription ?? 'createTask failed' };

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch('https://api.capmonster.cloud/getTaskResult', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPTCHA_API_KEY, taskId: cj.taskId }),
      });
      const rj = (await r.json()) as { status?: string; solution?: { gRecaptchaResponse?: string; token?: string }; errorDescription?: string };
      if (rj.status === 'ready') {
        const token = rj.solution?.gRecaptchaResponse ?? rj.solution?.token;
        return { solved: !!token, token, provider: 'capmonster', solveTimeSec: Math.round((Date.now() - start) / 1000) };
      }
      if (rj.errorDescription) return { solved: false, provider: 'capmonster', error: rj.errorDescription };
    }
    return { solved: false, provider: 'capmonster', error: 'timeout' };
  } catch (err) {
    return { solved: false, provider: 'capmonster', error: err instanceof Error ? err.message : String(err) };
  }
}
