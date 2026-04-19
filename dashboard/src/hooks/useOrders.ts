import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLiveEvents } from '../api/stream';

export interface OrderRow {
  sale_id: number;
  listing_id: number;
  listing_title: string | null;
  listing_temu_url: string | null;
  buyer_name: string;
  paid_at: string | null;
  shipped_at: string | null;
  temu_order_id: string | null;
  temu_state: string | null;
  temu_amount_eur: number | null;
  tracking_number: string | null;
  temu_placed_at: string | null;
  temu_last_error: string | null;
}

export function useOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<OrderRow[]>('/orders');
      setOrders(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLiveEvents((e) => {
    if (e.type === 'temu_order.updated') void reload();
  });

  return { orders, loading, error, reload };
}
