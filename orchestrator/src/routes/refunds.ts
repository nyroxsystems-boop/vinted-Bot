// ──────────────────────────────────────────────────────────────────────────────
// Refund / Dispute routes (dashboard-facing)
//
//   GET  /api/refunds?status=open|awaiting_cj|closed|...&account_id=&limit=
//        → list disputes (newest first) with sale + buyer joins
//   GET  /api/refunds/:id          → single dispute with full sale/listing context
//   POST /api/refunds              → open a dispute manually
//   POST /api/refunds/:id/resolve  body { resolution, refund_eur? } → close
//   POST /api/refunds/:id/reject   → mark rejected
//   PATCH /api/refunds/:id         body { ...partial }  → update
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  createLogger,
  getDb,
  listDisputes,
  openDispute,
  updateDispute,
  closeDispute,
  REFUND_REASONS,
  REFUND_STATUSES,
  type RefundReason,
  type RefundStatus,
} from '@vinted-system/shared';
import { eventBus } from '../events.js';

const log = createLogger('routes:refunds');
export const refundsRouter = Router();

function joinedDisputes(rows: ReturnType<typeof listDisputes>): unknown[] {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id).filter((v): v is number => typeof v === 'number');
  if (ids.length === 0) return rows;

  // Pull sale + listing context for the IDs in a single round-trip.
  const ctxRows = getDb().prepare(`
    SELECT rd.id AS dispute_id,
           s.marketplace,
           s.buyer_name,
           s.paid_at,
           s.tracking_number,
           l.title         AS listing_title,
           l.vinted_url    AS listing_url,
           l.list_price_eur
      FROM refund_disputes rd
      JOIN sales s     ON s.id = rd.sale_id
      JOIN listings l  ON l.id = s.listing_id
     WHERE rd.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as Array<{ dispute_id: number; [k: string]: unknown }>;

  const byId = new Map<number, Record<string, unknown>>();
  for (const r of ctxRows) byId.set(r.dispute_id, r);

  return rows.map((r) => {
    const ctx = r.id ? byId.get(r.id) : undefined;
    return {
      ...r,
      sale_context: ctx
        ? {
            marketplace: ctx.marketplace,
            buyer_name: ctx.buyer_name,
            paid_at: ctx.paid_at,
            tracking_number: ctx.tracking_number,
            listing_title: ctx.listing_title,
            listing_url: ctx.listing_url,
            list_price_eur: ctx.list_price_eur,
          }
        : null,
    };
  });
}

refundsRouter.get('/', (req, res) => {
  try {
    const statusRaw = (req.query.status as string | undefined)?.trim();
    const status = statusRaw && (REFUND_STATUSES as string[]).includes(statusRaw) ? (statusRaw as RefundStatus) : undefined;
    const accountId = req.query.account_id ? Number(req.query.account_id) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const rows = listDisputes({ status, accountId, limit });
    res.json({ ok: true, disputes: joinedDisputes(rows), count: rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.get('/stats', (_req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT status, COUNT(*) AS count
        FROM refund_disputes
       GROUP BY status
    `).all() as Array<{ status: RefundStatus; count: number }>;
    const stats: Record<string, number> = { open: 0, awaiting_cj: 0, refunded_buyer: 0, closed: 0, rejected: 0 };
    for (const r of rows) stats[r.status] = r.count;
    const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM refund_disputes`).get() as { c: number }).c;
    res.json({ ok: true, total, by_status: stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }
    const rows = listDisputes({ limit: 500 }).filter((d) => d.id === id);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'dispute not found' });
    const joined = joinedDisputes(rows);
    res.json({ ok: true, dispute: joined[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.post('/', (req, res) => {
  try {
    const {
      sale_id, reason, status, buyer_message,
      customer_evidence_url, refund_eur, cj_refund_id,
      resolution_note, account_id,
    } = (req.body ?? {}) as {
      sale_id?: number;
      reason?: RefundReason;
      status?: RefundStatus;
      buyer_message?: string;
      customer_evidence_url?: string;
      refund_eur?: number;
      cj_refund_id?: string;
      resolution_note?: string;
      account_id?: number;
    };
    if (!sale_id || !Number.isFinite(sale_id)) {
      return res.status(400).json({ ok: false, error: 'sale_id required' });
    }
    if (!reason || !(REFUND_REASONS as string[]).includes(reason)) {
      return res.status(400).json({ ok: false, error: `reason must be one of ${REFUND_REASONS.join(',')}` });
    }
    const id = openDispute({
      sale_id, reason,
      status: status ?? 'open',
      account_id,
      buyer_message,
      customer_evidence_url,
      refund_eur,
      cj_refund_id,
      resolution_note,
    });
    log.info('Refund dispute opened (manual)', { id, sale_id, reason });
    eventBus.publish({
      type: 'alert',
      level: 'warn',
      message: `📝 Manueller Refund-Dispute: Sale #${sale_id} → "${reason}"`,
    });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.patch('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }
    const patch = req.body ?? {};
    if (patch.status && !(REFUND_STATUSES as string[]).includes(patch.status)) {
      return res.status(400).json({ ok: false, error: 'invalid status' });
    }
    if (patch.reason && !(REFUND_REASONS as string[]).includes(patch.reason)) {
      return res.status(400).json({ ok: false, error: 'invalid reason' });
    }
    updateDispute(id, patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.post('/:id/resolve', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }
    const { resolution, refund_eur } = (req.body ?? {}) as { resolution?: string; refund_eur?: number | string | null };
    const note = resolution?.trim() || 'Resolved by operator';
    const refundAmt = refund_eur === undefined || refund_eur === null || refund_eur === ''
      ? undefined
      : Number(refund_eur);
    if (refundAmt !== undefined && (!Number.isFinite(refundAmt) || refundAmt < 0)) {
      return res.status(400).json({ ok: false, error: 'refund_eur must be a non-negative number' });
    }
    closeDispute(id, note, refundAmt);
    log.info('Refund dispute resolved', { id, refundAmt });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

refundsRouter.post('/:id/reject', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }
    const { reason } = (req.body ?? {}) as { reason?: string };
    updateDispute(id, { status: 'rejected', resolution_note: reason?.trim() || 'Rejected by operator' });
    log.info('Refund dispute rejected', { id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
