// useAuth — tiny session hook backed by /api/auth/me + cookie.
//
// One source of truth for "is the user logged in" across the app: the
// session cookie set by the server. We hit /api/auth/me on mount, cache
// the result, and expose login / register / logout that re-resolve.

import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
  id: number;
  email: string;
  name?: string | null;
  is_admin?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, ready: false, error: null });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await r.json();
      setState({ user: data.user ?? null, ready: true, error: null });
    } catch (e) {
      setState({ user: null, ready: true, error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error ?? 'login_failed');
    await refresh();
    return data.user as AuthUser;
  }, [refresh]);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error ?? 'register_failed');
    await refresh();
    return data.user as AuthUser;
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    await refresh();
  }, [refresh]);

  return { ...state, refresh, login, register, logout };
}
