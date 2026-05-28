import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { IconButton } from './IconButton.js';

/**
 * feat/auth-gate — fixed top-right logout chip, sibling of ThemeToggle.
 *
 * The user identity isn't exposed here (the app is single-user); the
 * sole action is "sign out". On click → AuthContext.logout() → POST
 * /api/v1/auth/logout (clears cookie) → AuthContext flips to unauthed
 * → App.tsx renders LoginScreen.
 */
export const LogoutButton = (): JSX.Element | null => {
  const { state, logout } = useAuth();
  // Only render when authenticated. The login screen has no use for a
  // logout button.
  if (state.phase !== 'authed') return null;
  return (
    <div className="logout-button" aria-label="Account">
      <IconButton
        icon={<LogOut size={18} strokeWidth={2.25} />}
        variant="ghost"
        onClick={() => {
          void logout();
        }}
        aria-label={`Sign out (${state.user.username})`}
        title={`Sign out (${state.user.username})`}
        data-testid="logout-button"
      />
    </div>
  );
};
