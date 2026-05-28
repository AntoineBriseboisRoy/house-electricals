import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { IconButton } from './IconButton.js';
import { ChangePasswordModal } from '../components/ChangePasswordModal.js';

/**
 * feat/auth-gate (sign-up flow) — floating top-right account chip.
 *
 * Sits between ThemeToggle and LogoutButton. Clicking opens the
 * Change-password modal. Only renders when the user is authed (no
 * point showing it on the login or sign-up screen).
 */
export const AccountButton = (): JSX.Element | null => {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);

  if (state.phase !== 'authed') return null;

  return (
    <>
      <div className="account-button" aria-label="Account">
        <IconButton
          icon={<KeyRound size={18} strokeWidth={2.25} />}
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label="Change password"
          title="Change password"
          data-testid="account-button"
        />
      </div>
      <ChangePasswordModal open={open} onClose={() => setOpen(false)} />
    </>
  );
};
