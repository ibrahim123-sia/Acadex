// Session state for the web app: restores the session from the refresh cookie on load,
// renews the access token shortly before it expires, and keeps tabs in sync.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, MfaChallengeResponse, Permission, InstitutionSummary, SessionUser } from '@acadex/shared';
import { api, onSessionEnded, refreshSession, tokenStore } from './api';
import { setFormatInstitution } from './format';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  user: SessionUser | null;
  institution: InstitutionSummary | null;
}

interface AuthApi extends AuthState {
  /** Returns the 2FA challenge token when a second factor is needed. */
  login: (email: string, password: string) => Promise<{ mfaToken: string } | null>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  /** Apply a fresh session from any endpoint that returns one (invite accept, password change, 2FA on). */
  applySession: (res: AuthResponse) => void;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthApi | null>(null);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('acadex-auth') : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, institution: null });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const signedOut = useCallback(() => {
    clearTimeout(timer.current);
    tokenStore.set(null);
    setFormatInstitution(null);
    queryClient.clear();
    setState({ status: 'anonymous', user: null, institution: null });
  }, [queryClient]);

  const applySession = useCallback(
    (res: AuthResponse) => {
      tokenStore.set(res.access_token);
      setFormatInstitution(res.institution);
      setState({ status: 'authenticated', user: res.user, institution: res.institution });
      clearTimeout(timer.current);
      // renew a minute before expiry
      timer.current = setTimeout(async () => {
        const renewed = await refreshSession();
        if (renewed) applySession(renewed);
        else signedOut();
      }, Math.max(10, res.expires_in - 60) * 1000);
    },
    [signedOut]
  );

  // restore the session on load
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((res) => {
      if (cancelled) return;
      if (res) applySession(res);
      else signedOut();
    });
    return () => {
      cancelled = true;
    };
  }, [applySession, signedOut]);

  useEffect(() => onSessionEnded(signedOut), [signedOut]);

  // another tab signed out / in
  useEffect(() => {
    if (!channel) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'logout') signedOut();
      if (e.data === 'login') refreshSession().then((res) => res && applySession(res));
    };
    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [applySession, signedOut]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<AuthResponse | MfaChallengeResponse>('/auth/login', { email, password }, { noRefresh: true });
      if ('mfa_required' in res) return { mfaToken: res.mfa_token };
      applySession(res);
      channel?.postMessage('login');
      return null;
    },
    [applySession]
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      applySession(await api.post<AuthResponse>('/auth/mfa/verify', { mfa_token: mfaToken, code }, { noRefresh: true }));
      channel?.postMessage('login');
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { noRefresh: true });
    } catch {
      /* signed out locally anyway */
    }
    channel?.postMessage('logout');
    signedOut();
  }, [signedOut]);

  const value = useMemo<AuthApi>(
    () => ({
      ...state,
      login,
      verifyMfa,
      applySession,
      logout,
      can: (p) => !!state.user?.permissions.includes(p),
    }),
    [state, login, verifyMfa, applySession, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
