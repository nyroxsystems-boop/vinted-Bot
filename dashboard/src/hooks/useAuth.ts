import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export type SessionState = 'unknown' | 'valid' | 'invalid' | 'checking';
export type LoginFlowState = 'idle' | 'waiting' | 'success' | 'failed';

export interface BotAuth {
  session: {
    state: SessionState;
    checked_at: string | null;
    message: string | null;
  };
  login: {
    state: LoginFlowState;
    message: string;
    started_at: string | null;
    finished_at: string | null;
  };
}

export type AuthBundle = Record<string, BotAuth | { error: string }>;

export function useAuthStatus(pollMs = 3000) {
  const [data, setData] = useState<AuthBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api.get<AuthBundle>('/auth/status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  const startLogin = useCallback(async (which: string) => {
    await api.post(`/auth/${which}/login`);
    await reload();
  }, [reload]);

  return { data, loading, reload, startLogin };
}

export function hasBotAuth(a: BotAuth | { error: string } | undefined): a is BotAuth {
  return !!a && 'session' in a;
}
