import { useCallback, useEffect, useState } from 'react';
import type { TemuBatch } from '@vinted-system/shared';
import { api } from '../api/client';

export interface QueueItem {
  sale_id: number;
  paid_at: string;
  buyer_name: string;
  listing_id: number;
  listing_title: string;
  temu_url: string;
  temu_variant: string | null; // JSON string
  list_price_eur: number;
}

export interface BatchItem {
  temu_order_id_pk: number;
  sale_id: number;
  state: string;
  last_error: string | null;
  amount_eur: number | null;
  buyer_name: string;
  listing_title: string;
  temu_url: string;
  list_price_eur: number;
  min_accept_price_eur: number;
}

export function useQueue(hours: number) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ hours: number; items: QueueItem[] }>(
        `/fulfillment/queue?hours=${hours}`,
      );
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload };
}

export function useBatches() {
  const [batches, setBatches] = useState<TemuBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<TemuBatch[]>('/fulfillment/batches');
      setBatches(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { batches, loading, reload };
}

export async function createBatch(windowHours: number) {
  return api.post<{ ok: boolean; batchId: number; saleCount: number }>(
    '/fulfillment/batches',
    { windowHours },
  );
}

export async function addBatchToCart(batchId: number) {
  return api.post<{
    ok: boolean;
    added: number;
    failed: number;
    items: Array<{ saleId: number; added: boolean; error?: string }>;
    cartUrl: string;
  }>(`/fulfillment/batches/${batchId}/add-to-cart`);
}

export async function markBatchPlaced(batchId: number, temuOrderId?: string) {
  return api.post<{ ok: boolean }>(
    `/fulfillment/batches/${batchId}/mark-placed`,
    temuOrderId ? { temuOrderId } : undefined,
  );
}

export async function loadBatch(batchId: number) {
  return api.get<{ batch: TemuBatch; items: BatchItem[] }>(
    `/fulfillment/batches/${batchId}`,
  );
}
