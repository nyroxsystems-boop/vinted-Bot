import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createLogger, runMigrations } from '@vinted-system/shared';
import { listingsRouter } from './routes/listings.js';
import { chatsRouter } from './routes/chats.js';
import { offersRouter } from './routes/offers.js';
import { ordersRouter } from './routes/orders.js';
import { settingsRouter } from './routes/settings.js';
import { streamRouter } from './routes/stream.js';
import { statusRouter } from './routes/status.js';
import { fulfillmentRouter } from './routes/fulfillment.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { startScheduler, stopScheduler } from './scheduler.js';

const log = createLogger('orchestrator');
const PORT = Number.parseInt(process.env.ORCHESTRATOR_PORT ?? '4700', 10);

// Ensure DB exists/migrated before any route reads it.
runMigrations();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'orchestrator' }));

app.use('/api/listings', listingsRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/offers', offersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/status', statusRouter);
app.use('/api/fulfillment', fulfillmentRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/auth', authRouter);
app.use('/stream', streamRouter);

const server = app.listen(PORT, () => {
  log.info(`Orchestrator listening on http://localhost:${PORT}`);
  startScheduler();
});

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal} — shutting down`);
  stopScheduler();
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
