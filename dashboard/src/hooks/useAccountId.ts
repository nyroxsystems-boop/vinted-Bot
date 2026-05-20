import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Returns the currently selected account id, polling /api/accounts/current
// once on mount. Hot-switches are handled by AccountSwitcher reloading the
// page, so a one-shot fetch is enough.
export function useAccountId(): number {
  const [id, setId] = useState<number>(1);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ currentId: number }>('/accounts/current');
        if (!cancelled && Number.isInteger(r.currentId) && r.currentId > 0) {
          setId(r.currentId);
        }
      } catch {
        // Backend offline — stick with the safe default. The
        // OrchestratorHealthBanner already surfaces this to the user.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return id;
}
