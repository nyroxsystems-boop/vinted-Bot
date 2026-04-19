import 'dotenv/config';
import { createLogger } from '@vinted-system/shared';
import { createVintedApi } from './api.js';
import { closeVintedBrowser } from './browser.js';

const log = createLogger('vinted-bot');
const PORT = Number.parseInt(process.env.VINTED_BOT_PORT ?? '4701', 10);

const app = createVintedApi();
const server = app.listen(PORT, () => {
  log.info(`Vinted-bot API listening on http://localhost:${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal} — shutting down`);
  server.close();
  await closeVintedBrowser();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
