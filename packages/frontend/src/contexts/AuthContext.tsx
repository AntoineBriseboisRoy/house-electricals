import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchAuthMe,
  setUnauthorizedHandler,
  submitLogin,
  submitLogout,
  type AuthUser,
} from '../api.js';

/**
 * feat/auth-gate — single-user auth state.
 *
 * Lifecycle:
 *   1. Mount → call /api/v1/auth/me. If 401 → user is null → LoginScreen.
 *      If 200 → user is the returned { username } → render the AppShell.
 *   2. Login → POST /api/v1/auth/login. On success the server sets the
 *      `he_auth` cookie; we set user state and the app re-renders.
 *   3. Logout → POST /api/v1/auth/logout (clears cookie) + clear local
 *      state → LoginScreen.
 *   4. 401 mid-session (token expired) → api.ts fires the
 *      unauthorizedHandler → we clear user → LoginScreen.
 */

type AuthState =
  | { phase: 'loading'; user: null }
  | { phase: 'unauthed'; user: null }
  | { phase: 'authed'; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => {
  const [state, setState] = useState<AuthState>({
    phase: 'loading',
    user: null,
  });

  // Initial probe: who am I?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchAuthMe();
        if (cancelled) return;
        if (me === null) {
          setState({ phase: 'unauthed', user: null });
        } else {
          setState({ phase: 'authed', user: me });
        }
      } catch {
        if (cancelled) return;
        // Network or unexpected error — fail closed (show login).
        setState({ phase: 'unauthed', user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wire the global 401 trap so any expired-session API call kicks us
  // back to the LoginScreen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ phase: 'unauthed', user: null });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      const user = await submitLogin(username, password);
      setState({ phase: 'authed', user });
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await submitLogout();
    } catch {
      // Best-effort — the cookie is already client-deletable on a 4xx.
    }
    setState({ phase: 'unauthed', user: null });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth() must be used inside <AuthProvider>.');
  }
  return ctx;
};
