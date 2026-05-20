// ──────────────────────────────────────────────────────────────────────────────
// Bot Watchdog — pings every marketplace bot's /api/health every 60 s.
//
// After 2 consecutive failures we publish a `bot.error` event (picked up by
// telegram-alerts) so the user knows a bot has gone down. After recovery we
// publish `bot.recovered`. State is tracked in-memory; resets on orchestrator
// restart.
//
// Why this matters: the system silently lost 3 days of data when KA-bot died
// in mid-May. Without a watchdog the user only finds out when an order rolls
// in that never shows up in the dashboard.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getSetting } from '@vinted-system/shared';
import { eventBus } from './events.js';

const log = createLogger('bot-watchdog');

interface BotDef {
  name: string;
  port: number;
  marketplace: string;
  /** Setting key gating the bot. If the value isn't 'true', we don't alert
   *  on downtime because the user has explicitly disabled this marketplace. */
  gate?: string;
}

// Pulled from ecosystem.config.cjs ports. cj-service excluded — it has its
// own health surface elsewhere and isn't a marketplace bot.
const BOTS: BotDef[] = [
  { name: 'vinted-bot',         port: 4701, marketplace: 'vinted' },
  { name: 'kleinanzeigen-bot',  port: 4703, marketplace: 'kleinanzeigen', gate: 'kleinanzeigen_enabled' },
  { name: 'mercari-bot',        port: 4704, marketplace: 'mercari',       gate: 'mercari_enabled' },
  { name: 'depop-bot',          port: 4705, marketplace: 'depop',         gate: 'depop_enabled' },
  { name: 'wallapop-bot',       port: 4706, marketplace: 'wallapop',      gate: 'wallapop_enabled' },
  { name: 'ebay-de-bot',        port: 4707, marketplace: 'ebay_de',       gate: 'ebay_de_enabled' },
  { name: 'ebay-uk-bot',        port: 4708, marketplace: 'ebay_uk',       gate: 'ebay_uk_enabled' },
  { name: 'etsy-bot',           port: 4709, marketplace: 'etsy',          gate: 'etsy_enabled' },
  { name: 'grailed-bot',        port: 4710, marketplace: 'grailed',       gate: 'grailed_enabled' },
  { name: 'fb-marketplace-bot', port: 4711, marketplace: 'fb_marketplace', gate: 'fb_marketplace_enabled' },
];

const FAILURE_THRESHOLD = 2;   // alert after this many consecutive misses
const PING_INTERVAL_MS = 60_000;
const PING_TIMEOUT_MS = 5_000;
// Throttle the same-bot alert: after one alert, don't re-alert for this many ms
// even if it stays down. Recovery resets the throttle. Avoids Telegram spam
// when a bot is genuinely broken and we restart-loop it.
const ALERT_REPEAT_MS = 30 * 60_000;  // 30 min

interface BotState {
  consecutiveFailures: number;
  alerted: boolean;
  lastAlertAt: number;
}
const state = new Map<string, BotState>();

let timer: ReturnType<typeof setInterval> | null = null;

async function pingBot(bot: BotDef): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch(`http://localhost:${bot.port}/api/health`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const body = await r.json().catch(() => ({})) as { ok?: boolean };
    if (body.ok === false) return { ok: false, detail: 'health returned ok:false' };
    return { ok: true, detail: 'ok' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function tick(): Promise<void> {
  for (const bot of BOTS) {
    // Honor per-marketplace enable flag (default to ON for unspecified bots).
    if (bot.gate) {
      const enabled = getSetting(bot.gate);
      if (enabled === 'false') continue;
    }
    const s = state.get(bot.name) ?? { consecutiveFailures: 0, alerted: false, lastAlertAt: 0 };
    const probe = await pingBot(bot);

    if (probe.ok) {
      if (s.consecutiveFailures > 0 || s.alerted) {
        log.info('bot recovered', { bot: bot.name });
        if (s.alerted) {
          eventBus.publish({
            type: 'alert',
            level: 'warn',
            message: `✅ Bot wieder online: <b>${bot.name}</b> (${bot.marketplace})`,
          });
        }
      }
      state.set(bot.name, { consecutiveFailures: 0, alerted: false, lastAlertAt: 0 });
      continue;
    }

    s.consecutiveFailures++;
    state.set(bot.name, s);
    log.warn('bot ping failed', { bot: bot.name, fails: s.consecutiveFailures, detail: probe.detail });

    if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      const now = Date.now();
      const recentlyAlerted = s.alerted && (now - s.lastAlertAt) < ALERT_REPEAT_MS;
      if (!recentlyAlerted) {
        eventBus.publish({
          type: 'bot.error',
          bot: bot.name,
          error: `Health-Probe failed ${s.consecutiveFailures}x: ${probe.detail}`,
        });
        s.alerted = true;
        s.lastAlertAt = now;
      }
    }
  }
}

export function startBotWatchdog(): void {
  if (timer) return;
  log.info('Bot Watchdog started', { intervalMs: PING_INTERVAL_MS, bots: BOTS.length });
  // First tick after 30 s — gives newly-spawned bots time to bind their ports.
  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), PING_INTERVAL_MS);
}

export function stopBotWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('Bot Watchdog stopped');
  }
}
