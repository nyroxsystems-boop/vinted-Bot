import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export interface DailyRow {
  date: string;
  offers: number;
  accepted: number;
  paid: number;
  revenue_eur: number;
}

export interface TopListing {
  id: number;
  title: string;
  list_price_eur: number;
  sales_count: number;
  revenue_eur: number | null;
}

export interface FunnelData {
  offers: number;
  accepted: number;
  paid: number;
  fulfilled: number;
}

export function useDaily(days: number) {
  const [data, setData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<DailyRow[]>(`/analytics/daily?days=${days}`));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading };
}

export function useTopListings(days: number, limit = 10) {
  const [data, setData] = useState<TopListing[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<TopListing[]>(`/analytics/top-listings?days=${days}&limit=${limit}`));
    } finally {
      setLoading(false);
    }
  }, [days, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading };
}

export function useFunnel(days: number) {
  const [data, setData] = useState<FunnelData | null>(null);

  const reload = useCallback(async () => {
    setData(await api.get<FunnelData>(`/analytics/funnel?days=${days}`));
  }, [days]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data };
}
