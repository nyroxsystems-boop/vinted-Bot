// ──────────────────────────────────────────────────────────────────────────────
// Kleinanzeigen Pipeline
//
// Pollt das KA-Postfach periodisch über den kleinanzeigen-bot HTTP endpoint.
// Schreibt selber nichts in die DB — der Bot macht das.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger, getCurrentAccountId, getSetting, isPaused, withLock } from '@vinted-system/shared';

const log = createLogger('ka-pipeline');
const KA_BOT_URL = process.env.KLEINANZEIGEN_BOT_URL ?? 'http://localhost:4703';

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function intervalMs(): number {
  const s = parseInt(getSetting('kleinanzeigen_poll_interval_s') ?? '120', 10);
  return Math.max(60, s) * 1000; // floor 60s
}

async function tick(): Promise<void> {
  if (isRunning) return;
  if (isPaused()) return;
  if (getSetting('kleinanzeigen_enabled') !== 'true') return;
  isRunning = true;
  try {
    await withLock('ka-pipeline-tick', 300, async () => {
      const r = await fetch(`${KA_BOT_URL}/api/chats/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: getCurrentAccountId() }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) {
        const text = await r.text();
        log.warn('ka inbox-poll http error', { status: r.status, body: text.slice(0, 200) });
        return;
      }
      const data = await r.json() as { conversations?: number; newMessages?: number; errors?: number };
      if ((data.newMessages ?? 0) > 0) {
        log.info('ka inbox polled', data);
      }
    });
  } catch (err) {
    log.warn('ka inbox-poll exception', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

export function startKleinanzeigenPipeline(): void {
  if (timer) return;
  log.info(`Kleinanzeigen pipeline starting (interval=${intervalMs() / 1000}s)`);
  // Erster Tick nach 30s
  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), intervalMs());
}

export function stopKleinanzeigenPipeline(): void {
  if (timer) { clearInterval(timer); timer = null; log.info('Kleinanzeigen pipeline stopped'); }
}
