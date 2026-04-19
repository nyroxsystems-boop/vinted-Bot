import { useCallback, useEffect, useState } from 'react';
import type { Listing } from '@vinted-system/shared';
import { api } from '../api/client';

export function useListings() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<Listing[]>('/listings');
      setListings(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (payload: Partial<Listing>) => {
      const row = await api.post<Listing>('/listings', payload);
      await reload();
      return row;
    },
    [reload],
  );

  const update = useCallback(
    async (id: number, payload: Partial<Listing>) => {
      const row = await api.patch<Listing>(`/listings/${id}`, payload);
      await reload();
      return row;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      await api.del<void>(`/listings/${id}`);
      await reload();
    },
    [reload],
  );

  return { listings, loading, error, reload, create, update, remove };
}
