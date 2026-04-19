import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface Kpis {
  active_listings: number;
  pending_offers: number;
  pending_sales: number;
  open_temu_orders: number;
  failed_temu_orders: number;
}

interface StatusBundle {
  kpis: Kpis;
  bots: {
    vinted: unknown;
    temu: unknown;
  };
}

export function useStatus(pollMs = 10_000) {
  const [data, setData] = useState<StatusBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const bundle = await api.get<StatusBundle>('/status');
      setData(bundle);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { data, error, reload };
}
