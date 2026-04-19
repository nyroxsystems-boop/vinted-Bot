import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<Record<string, string>>('/settings');
      setSettings(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(
    async (patch: Record<string, string | number | boolean>) => {
      await api.patch('/settings', patch);
      await reload();
    },
    [reload],
  );

  return { settings, loading, update, reload };
}
