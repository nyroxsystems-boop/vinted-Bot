// ──────────────────────────────────────────────────────────────────────────────
// Account-Health Routes
//
//   GET  /api/accounts/:id/health        → { status, lastEventAt, events: [...] }
//   POST /api/accounts/:id/unpause       → unpause (manual review done)
//   GET  /api/health/dashboard           → per-account snapshot for the
//                                           health-overview page
//
// Mounted under the bare `/api` root so the URL shape matches the spec
// (`/api/accounts/:id/health` rather than nested under accountsRouter).
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  getAccount,
  getAccountHealth,
  listAccounts,
  recomputeHealthStatus,
  unpauseAccount,
} from '@vinted-system/shared';
import { eventBus } from '../events.js';

export const accountHealthRouter = Router();

accountHealthRouter.get('/accounts/:id/health', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid account id' });
  }
  const account = getAccount(id);
  if (!account) return res.status(404).json({ error: 'account not found' });

  // Refresh the cached status on the row so the response is up-to-date
  // even between watcher ticks — cheap read query.
  recomputeHealthStatus(id);
  const health = getAccountHealth(id);

  res.json({
    account_id: id,
    label: account.label,
    marketplace: account.marketplace ?? 'vinted',
    active: !!account.active,
    ...health,
  });
});

accountHealthRouter.post('/accounts/:id/unpause', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid account id' });
  }
  const account = getAccount(id);
  if (!account) return res.status(404).json({ error: 'account not found' });

  try {
    unpauseAccount(id);
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `Account #${id} (${account.label}) manuell wieder aktiviert`,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Aggregated snapshot for a dashboard "health overview" page — one entry
// per account with the cached status pill + last event timestamp. Cheap
// to call (single COUNT + JOIN), safe to poll every few seconds.
accountHealthRouter.get('/health/dashboard', (_req, res) => {
  const accounts = listAccounts();
  const items = accounts.map((acc) => {
    // Refresh on read so the dashboard pill never shows stale data.
    const status = recomputeHealthStatus(acc.id);
    const health = getAccountHealth(acc.id);
    return {
      account_id: acc.id,
      label: acc.label,
      marketplace: acc.marketplace ?? 'vinted',
      active: !!acc.active,
      status,
      lastEventAt: health.lastEventAt,
      recentEventCount: health.events.length,
      lastEventType: health.events[0]?.type ?? null,
      lastEventMessage: health.events[0]?.message ?? null,
    };
  });

  res.json({ items });
});
