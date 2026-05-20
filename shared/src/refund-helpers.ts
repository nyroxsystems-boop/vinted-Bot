// ──────────────────────────────────────────────────────────────────────────────
// Refund / Dispute DB helpers
//
// Thin typed wrapper around the `refund_disputes` table. The actual schema
// lives in shared/src/schema.sql; this file just exposes a small CRUD API
// so the refund-workflow worker, routes, and dashboard can share the same
// types without re-querying SQL strings everywhere.
// ──────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export type RefundReason =
  | 'not_arrived'
  | 'wrong_size'
  | 'damaged'
  | 'not_as_described'
  | 'other';

export type RefundStatus =
  | 'open'
  | 'awaiting_cj'
  | 'refunded_buyer'
  | 'closed'
  | 'rejected';

export interface RefundDispute {
  id?: number;
  sale_id: number;
  account_id?: number | null;
  reason: RefundReason;
  status?: RefundStatus;
  buyer_message?: string | null;
  customer_evidence_url?: string | null;
  refund_eur?: number | null;
  cj_refund_id?: string | null;
  resolution_note?: string | null;
  opened_at?: string;
  resolved_at?: string | null;
}

export const REFUND_REASONS: RefundReason[] = [
  'not_arrived', 'wrong_size', 'damaged', 'not_as_described', 'other',
];
export const REFUND_STATUSES: RefundStatus[] = [
  'open', 'awaiting_cj', 'refunded_buyer', 'closed', 'rejected',
];

/** Create a new dispute row. Returns the inserted id. */
export function openDispute(d: RefundDispute): number {
  const row = getDb().prepare(`
    INSERT INTO refund_disputes (
      sale_id, account_id, reason, status,
      buyer_message, customer_evidence_url,
      refund_eur, cj_refund_id, resolution_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    d.sale_id,
    d.account_id ?? null,
    d.reason,
    d.status ?? 'open',
    d.buyer_message ?? null,
    d.customer_evidence_url ?? null,
    d.refund_eur ?? null,
    d.cj_refund_id ?? null,
    d.resolution_note ?? null,
  ) as { id: number };
  return row.id;
}

export interface ListDisputeFilter {
  status?: RefundStatus;
  accountId?: number;
  saleId?: number;
  limit?: number;
}

/** List disputes, newest-first, with optional filters. */
export function listDisputes(filter: ListDisputeFilter = {}): RefundDispute[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push('status = ?');
    args.push(filter.status);
  }
  if (filter.accountId !== undefined) {
    where.push('account_id = ?');
    args.push(filter.accountId);
  }
  if (filter.saleId !== undefined) {
    where.push('sale_id = ?');
    args.push(filter.saleId);
  }
  const sql = `
    SELECT id, sale_id, account_id, reason, status, buyer_message,
           customer_evidence_url, refund_eur, cj_refund_id, resolution_note,
           opened_at, resolved_at
      FROM refund_disputes
      ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY opened_at DESC
     LIMIT ?
  `;
  args.push(Math.max(1, Math.min(500, filter.limit ?? 100)));
  return getDb().prepare(sql).all(...args) as RefundDispute[];
}

/** Patch any subset of fields. Sets `resolved_at` automatically when status
 *  flips to a terminal state. */
export function updateDispute(id: number, patch: Partial<RefundDispute>): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Array<[keyof RefundDispute, string]> = [
    ['sale_id', 'sale_id'],
    ['account_id', 'account_id'],
    ['reason', 'reason'],
    ['status', 'status'],
    ['buyer_message', 'buyer_message'],
    ['customer_evidence_url', 'customer_evidence_url'],
    ['refund_eur', 'refund_eur'],
    ['cj_refund_id', 'cj_refund_id'],
    ['resolution_note', 'resolution_note'],
  ];
  for (const [k, col] of map) {
    if (k in patch) {
      sets.push(`${col} = ?`);
      args.push(patch[k] ?? null);
    }
  }
  if (patch.status && (['closed', 'refunded_buyer', 'rejected'] as RefundStatus[]).includes(patch.status)) {
    sets.push(`resolved_at = COALESCE(resolved_at, datetime('now'))`);
  }
  if (sets.length === 0) return;
  args.push(id);
  getDb().prepare(`UPDATE refund_disputes SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

/** Mark a dispute as resolved with a note + optional refund-amount. */
export function closeDispute(id: number, resolution: string, refundEur?: number): void {
  getDb().prepare(`
    UPDATE refund_disputes
       SET status = CASE
                      WHEN ? IS NOT NULL THEN 'refunded_buyer'
                      ELSE 'closed'
                    END,
           resolution_note = ?,
           refund_eur = COALESCE(?, refund_eur),
           resolved_at = datetime('now')
     WHERE id = ?
  `).run(refundEur ?? null, resolution, refundEur ?? null, id);
}

/** Convenience: does ANY dispute exist for this sale? Used by the workflow
 *  worker to avoid duplicate-opens. */
export function hasOpenDispute(saleId: number): boolean {
  const row = getDb().prepare(`
    SELECT 1 AS x FROM refund_disputes
     WHERE sale_id = ? AND status NOT IN ('closed','rejected','refunded_buyer')
     LIMIT 1
  `).get(saleId) as { x: number } | undefined;
  return !!row;
}
