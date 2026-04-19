import { Router, type Request, type Response } from 'express';
import type { SystemEvent } from '@vinted-system/shared';
import { eventBus } from '../events.js';

export const streamRouter = Router();

// Server-Sent Events: dashboard opens EventSource('/stream') and receives
// every SystemEvent in real time. Writes a heartbeat comment every 20s so
// proxies don't time out idle connections.
streamRouter.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onEvent = (event: SystemEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  eventBus.on('event', onEvent);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 20_000);

  res.on('close', () => {
    eventBus.off('event', onEvent);
    clearInterval(heartbeat);
  });
});
