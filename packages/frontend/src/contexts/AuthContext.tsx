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
  fetchSetupStatus,
  setUnauthorizedHandler,
  submitChangePassword,
  submitLogin,
  submitLogout,
  submitSignup,
  type AuthUser,
} from '../api.js';

/**
 * feat/auth-gate (sign-up flow) — single-user auth state.
 *
 * Lifecycle:
 *   1. Mount → GET /api/v1/auth/setup-status.
 *      - If `needsSetup` → SignupScreen.
 *      - Otherwise → GET /api/v1/auth/me. If 200 → authed; if 401 →
 *        LoginScreen.
 *   2. Sign-up (first user only) → POST /api/v1/auth/signup. Server
 *      sets the `he_auth` cookie + we transition to authed.
 *   3. Login → POST /api/v1/auth/login. Server sets cookie; we set
 *      user state and the app re-renders.
 *   4. Change password → PATCH /api/v1/auth/password. Existing cookie
 *      stays valid (JWT signature depends on AUTH_SECRET, not the
 *      password hash), so the user does NOT need to re-login.
 *   5. Logout → POST /api/v1/auth/logout (clears cookie) + clear local
 *      state → LoginScreen.
 *   6. 401 mid-session (token expired) → api.ts fires the
 *      unauthorizedHandler → we clear user → LoginScreen (NOT SignupScreen
 *      — the user row still exists; only the cookie is stale).
 */

type AuthState =
  | { phase: 'loading'; user: null }
  | { phase: 'needs-setup'; user: null }
  | { phase: 'unauthed'; user: null }
  | { phase: 'authed'; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  signup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<void>;
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

  // Initial probe: do we need first-time setup, or are we already past it?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { needsSetup } = await fetchSetupStatus();
        if (cancelled) return;
        if (needsSetup) {
          setState({ phase: 'needs-setup', user: null });
          return;
        }
        const me = await fetchAuthMe();
        if (cancelled) return;
        if (me === null) {
          setState({ phase: 'unauthed', user: null });
        } else {
          setState({ phase: 'authed', user: me });
        }
      } catch {
        if (cancelled) return;
        // Network or unexpected error — fail closed (show login). The
        // user can refresh once the backend recovers; setup-status will
        // re-probe.
        setState({ phase: 'unauthed', user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wire the global 401 trap so any expired-session API call kicks us
  // back to the LoginScreen — never SignupScreen, since the user row
  // still exists.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((prev) =>
        prev.phase === 'needs-setup' ? prev : { phase: 'unauthed', user: null }
      );
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signup = useCallback(
    async (username: string, password: string): Promise<void> => {
      const user = await submitSignup(username, password);
      setState({ phase: 'authed', user });
    },
    []
  );

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

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await submitChangePassword(currentPassword, newPassword);
      // Cookie remains valid (JWT signature depends on AUTH_SECRET,
      // which is independent of the password hash). No state change.
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{ state, signup, login, logout, changePassword }}
    >
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
