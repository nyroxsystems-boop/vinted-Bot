// ──────────────────────────────────────────────────────────────────────────────
// CAPTCHA-Status + Saldo
//
//   GET  /api/captcha/status   — provider, API-Key gesetzt, last solve
//   GET  /api/captcha/balance  — Saldo bei 2captcha / capmonster
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { createLogger, getSetting, setSetting } from '@vinted-system/shared';

const log = createLogger('routes:captcha');
export const captchaRouter = Router();

captchaRouter.get('/status', (_req, res) => {
  const provider = getSetting('captcha_provider') ?? '2captcha';
  const apiKeySet = !!process.env.CAPTCHA_API_KEY;
  const autoPause = getSetting('captcha_auto_pause_on_detect') === 'true';
  res.json({ ok: true, provider, apiKeySet, autoPause });
});

captchaRouter.get('/balance', async (_req, res) => {
  const provider = getSetting('captcha_provider') ?? '2captcha';
  const apiKey = process.env.CAPTCHA_API_KEY ?? '';
  if (!apiKey) return res.json({ ok: false, error: 'CAPTCHA_API_KEY not set in .env' });
  try {
    if (provider === '2captcha') {
      const r = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=getbalance&json=1`, {
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json() as { status: number; request: string };
      if (j.status !== 1) return res.json({ ok: false, error: j.request });
      const balanceUsd = parseFloat(j.request);
      return res.json({ ok: true, provider, balance_usd: balanceUsd, request_count_avg_cost_usd: 0.003 });
    }
    if (provider === 'capmonster') {
      const r = await fetch('https://api.capmonster.cloud/getBalance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json() as { errorId: number; balance?: number; errorDescription?: string };
      if (j.errorId !== 0) return res.json({ ok: false, error: j.errorDescription });
      return res.json({ ok: true, provider, balance_usd: j.balance });
    }
    res.json({ ok: false, error: `provider ${provider} balance not supported` });
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Update CAPTCHA config (provider + auto-pause)
captchaRouter.put('/config', (req, res) => {
  try {
    const { provider, auto_pause } = req.body as { provider?: string; auto_pause?: boolean };
    if (provider) setSetting('captcha_provider', provider);
    if (auto_pause !== undefined) setSetting('captcha_auto_pause_on_detect', auto_pause ? 'true' : 'false');
    log.info('CAPTCHA config updated', { provider, auto_pause });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Stats: wie oft CAPTCHA in den letzten 30 Tagen / Audio-Solver verfügbar?
captchaRouter.get('/stats', async (_req, res) => {
  try {
    const { isWhisperAvailableAsync } = await import('@vinted-system/shared');
    const whisper = await isWhisperAvailableAsync();
    const lastAlert = getSetting('captcha_last_alert');
    const db = (await import('@vinted-system/shared')).getDb();
    const failedListings = (db.prepare(`
      SELECT COUNT(*) AS cnt FROM auto_listings
       WHERE last_error LIKE '%[captcha]%'
         AND last_retry_at > datetime('now', '-30 days')
    `).get() as { cnt: number }).cnt;
    res.json({
      ok: true,
      captchas_last_30d: failedListings,
      last_captcha_at: lastAlert,
      whisper_available: whisper,
      provider: getSetting('captcha_provider') ?? 'manual',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Pause-Status — was hat das System pausiert?
captchaRouter.get('/pause-status', (_req, res) => {
  const paused = getSetting('paused') === 'true';
  // Wenn paused durch CAPTCHA-Logik: alert_last is set
  const lastAlert = getSetting('captcha_last_alert');
  res.json({
    ok: true,
    paused,
    paused_reason: paused && lastAlert ? `CAPTCHA seit ${lastAlert}` : null,
    captcha_alert_at: lastAlert,
  });
});

// Resume nach manueller CAPTCHA-Lösung
captchaRouter.post('/resume', (_req, res) => {
  setSetting('paused', 'false');
  setSetting('captcha_last_alert', '');
  log.info('System resumed by user (CAPTCHA dismissed)');
  res.json({ ok: true });
});
