import { useCallback, useEffect, useState } from 'react';
import type { Offer } from '@vinted-system/shared';
import { api } from '../api/client';
import { useLiveEvents } from '../api/stream';

export function useOffers(state: 'pending' | 'accepted' | 'declined' | 'expired' = 'pending') {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<Offer[]>(`/offers?state=${state}`);
      setOffers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [state]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLiveEvents((e) => {
    if (e.type === 'offer.new' || e.type === 'offer.decided') void reload();
  });

  const accept = useCallback(async (id: number) => {
    await api.post(`/offers/${id}/accept`);
    await reload();
  }, [reload]);

  const decline = useCallback(async (id: number) => {
    await api.post(`/offers/${id}/decline`);
    await reload();
  }, [reload]);

  const linkListing = useCallback(async (id: number, listingId: number) => {
    await api.patch(`/offers/${id}/listing`, { listingId });
    await reload();
  }, [reload]);

  return { offers, loading, error, reload, accept, decline, linkListing };
}
