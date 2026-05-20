// ──────────────────────────────────────────────────────────────────────────────
// Depop Pipeline
//
// Polls two endpoints on the depop-bot on a schedule:
//   1. /api/chats/poll      — inbox scrape (every depop_chat_poll_interval_s, default 240s)
//   2. /api/sold/poll       — sold-page scan (every depop_sold_poll_interval_s, default 600s)
//
// Both ticks are gated by:
//   - global `paused` setting
//   - `depop_enabled` setting (so user can disable Depop without stopping
//     the whole orchestrator)
// And both honor a per-tick lock to prevent overlap if a poll runs long.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getCurrentAccountId, getSetting, isPaused, withLock } from '@vinted-system/shared';

const log = createLogger('depop-pipeline');
const DEPOP_BOT_URL = process.env.DEPOP_BOT_URL ?? 'http://localhost:4705';

let chatTimer: NodeJS.Timeout | null = null;
let soldTimer: NodeJS.Timeout | null = null;
let chatRunning = false;
let soldRunning = false;

function chatIntervalMs(): number {
  const s = parseInt(getSetting('depop_chat_poll_interval_s') ?? '240', 10);
  return Math.max(120, s) * 1000; // floor 120s — Cloudflare-friendly
}

function soldIntervalMs(): number {
  const s = parseInt(getSetting('depop_sold_poll_interval_s') ?? '600', 10);
  return Math.max(300, s) * 1000; // floor 300s — sold-page change-rate is low
}

function isEnabled(): boolean {
  return getSetting('depop_enabled') === 'true';
}

async function chatTick(): Promise<void> {
  if (chatRunning) return;
  if (isPaused()) return;
  if (!isEnabled()) return;
  chatRunning = true;
  try {
    await withLock('depop-chat-tick', 300, async () => {
      const r = await fetch(`${DEPOP_BOT_URL}/api/chats/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: getCurrentAccountId() }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) {
        const text = await r.text();
        log.warn('depop inbox-poll http error', { status: r.status, body: text.slice(0, 200) });
        return;
      }
      const data = await r.json() as { conversations?: number; newMessages?: number; errors?: number };
      if ((data.newMessages ?? 0) > 0) {
        log.info('depop inbox polled', data);
      }
    });
  } catch (err) {
    log.warn('depop inbox-poll exception', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    chatRunning = false;
  }
}

async function soldTick(): Promise<void> {
  if (soldRunning) return;
  if (isPaused()) return;
  if (!isEnabled()) return;
  soldRunning = true;
  try {
    await withLock('depop-sold-tick', 300, async () => {
      const r = await fetch(`${DEPOP_BOT_URL}/api/sold/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: getCurrentAccountId() }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) {
        const text = await r.text();
        log.warn('depop sold-poll http error', { status: r.status, body: text.slice(0, 200) });
        return;
      }
      const data = await r.json() as { scanned?: number; newly_sold?: number; errors?: number };
      if ((data.newly_sold ?? 0) > 0) {
        log.info('depop newly sold', data);
      }
    });
  } catch (err) {
    log.warn('depop sold-poll exception', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    soldRunning = false;
  }
}

export function startDepopPipeline(): void {
  if (chatTimer || soldTimer) return;
  log.info(`Depop pipeline starting`, {
    chatInterval: chatIntervalMs() / 1000,
    soldInterval: soldIntervalMs() / 1000,
    enabled: isEnabled(),
  });
  // First chat tick after 45 s, sold after 90 s — stagger so we don't hammer
  // the bot's launch sequence twice in a row.
  setTimeout(() => void chatTick(), 45_000);
  setTimeout(() => void soldTick(), 90_000);
  chatTimer = setInterval(() => void chatTick(), chatIntervalMs());
  soldTimer = setInterval(() => void soldTick(), soldIntervalMs());
}

export function stopDepopPipeline(): void {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  if (soldTimer) { clearInterval(soldTimer); soldTimer = null; }
  log.info('Depop pipeline stopped');
}
