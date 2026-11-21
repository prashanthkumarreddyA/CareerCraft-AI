import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { configureAuth } from '../services/api';
import * as authApi from '../services/auth.service';

// The session token lives in localStorage so it survives reloads. Trade-off: readable by any
// script on this origin (XSS), which is why the app ships no third-party scripts. Cookies are
// not used because the frontend (Netlify) and API (Render) are on different sites.
const STORAGE_KEY = 'arb.session';

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (session?.token && new Date(session.expiresAt) > new Date()) return session;
  } catch {
    /* corrupted storage: treat as signed out */
  }
  localStorage.removeItem(STORAGE_KEY);
  return null;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession); // { token, expiresAt, user }
  const [status, setStatus] = useState(() => (readSession() ? 'verifying' : 'signed_out'));
  const tokenRef = useRef(session?.token ?? null);

  const saveSession = useCallback((next) => {
    tokenRef.current = next?.token ?? null;
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
    setSession(next);
    setStatus(next ? 'signed_in' : 'signed_out');
  }, []);

  useEffect(() => {
    configureAuth({
      tokenGetter: () => tokenRef.current,
      unauthorizedHandler: (err) => {
        if (!tokenRef.current) return;
        saveSession(null);
        toast.error(err.message || 'Your session has ended. Please sign in again.', { id: 'session-ended' });
      },
    });
  }, [saveSession]);

  // Confirm a stored session is still valid (it may have been revoked or the secret rotated).
  useEffect(() => {
    if (status !== 'verifying') return;
    let cancelled = false;
    authApi
      .fetchCurrentUser()
      .then((user) => !cancelled && saveSession({ ...readSession(), user }))
      .catch((err) => {
        if (cancelled) return;
        // Network trouble (e.g. server waking up) should not sign the user out.
        if (err.status === 401) saveSession(null);
        else setStatus('signed_in');
      });
    return () => {
      cancelled = true;
    };
  }, [status, saveSession]);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      status,
      async login(credentials) {
        const { user, token, expiresAt } = await authApi.login(credentials);
        saveSession({ user, token, expiresAt });
        return user;
      },
      async register(details) {
        const { user, token, expiresAt } = await authApi.register(details);
        saveSession({ user, token, expiresAt });
        return user;
      },
      async logout() {
        try {
          await authApi.logout(); // revokes the token server-side
        } catch {
          /* still sign out locally */
        }
        saveSession(null);
      },
    }),
    [session, status, saveSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
