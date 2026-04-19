import 'dotenv/config';
import { createLogger } from '@vinted-system/shared';
import { createTemuApi } from './api.js';
import { closeTemuBrowser } from './browser.js';

const log = createLogger('temu-bot');
const PORT = Number.parseInt(process.env.TEMU_BOT_PORT ?? '4702', 10);

const app = createTemuApi();
const server = app.listen(PORT, () => {
  log.info(`Temu-bot API listening on http://localhost:${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal} — shutting down`);
  server.close();
  await closeTemuBrowser();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
