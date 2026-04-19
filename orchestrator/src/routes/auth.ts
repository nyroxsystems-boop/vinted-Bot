import { Router } from 'express';
import type { SessionStatus } from '@vinted-system/shared';

const VINTED = `http://localhost:${process.env.VINTED_BOT_PORT ?? '4701'}`;
const TEMU = `http://localhost:${process.env.TEMU_BOT_PORT ?? '4702'}`;

interface BotAuthStatus {
  session: SessionStatus;
  login: {
    state: 'idle' | 'waiting' | 'success' | 'failed';
    message: string;
    started_at: string | null;
    finished_at: string | null;
  };
}

async function callBot<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${body.error ?? ''}`);
  }
  return body;
}

export const authRouter = Router();

/**
 * GET /api/auth/status
 * Aggregated view used by dashboard banners.
 */
authRouter.get('/status', async (_req, res) => {
  const [vintedRes, temuRes] = await Promise.allSettled([
    callBot<BotAuthStatus>(VINTED, '/login/status'),
    callBot<BotAuthStatus>(TEMU, '/login/status'),
  ]);
  res.json({
    vinted:
      vintedRes.status === 'fulfilled'
        ? vintedRes.value
        : { error: String(vintedRes.reason) },
    temu:
      temuRes.status === 'fulfilled'
        ? temuRes.value
        : { error: String(temuRes.reason) },
  });
});

authRouter.post('/vinted/login', async (_req, res) => {
  try {
    const r = await callBot<{ ok: boolean; status: BotAuthStatus['login'] }>(
      VINTED,
      '/login/start',
      { method: 'POST' },
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

authRouter.post('/temu/login', async (_req, res) => {
  try {
    const r = await callBot<{ ok: boolean; status: BotAuthStatus['login'] }>(
      TEMU,
      '/login/start',
      { method: 'POST' },
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
