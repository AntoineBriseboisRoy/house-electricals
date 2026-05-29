import { useMemo, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { ApiHttpError } from '../api.js';
import { Button, Input } from '../ui/index.js';
import { Modal } from '../ui/Modal.js';
import { toast } from '../ui/toast.js';

const MIN_PASSWORD_LENGTH = 8;

export type ChangePasswordModalProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * feat/auth-gate (sign-up flow) — change-password modal.
 *
 * Rendered by UserMenu (the bottom-tab Account sheet) when the user taps
 * "Change password" — fix/mobile-floating-cluster replaced the old floating
 * top-right Account chip with the tab-bar Account item. Server verifies the
 * current password before updating; cycle-73 `presentation="sheet"` pivots
 * to a mobile bottom-sheet below 720px.
 *
 * The signed-in session cookie stays valid after the password change
 * (JWT signature depends on AUTH_SECRET, not the password hash), so
 * the user doesn't need to re-login. Future cycle could opt to
 * invalidate other sessions by rotating AUTH_SECRET — out of scope.
 */
export const ChangePasswordModal = ({
  open,
  onClose,
}: ChangePasswordModalProps): JSX.Element => {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort =
    newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const sameAsCurrent =
    newPassword.length > 0 && newPassword === currentPassword;

  const inlineError = useMemo<string | null>(() => {
    if (tooShort) return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (mismatch) return 'New passwords do not match.';
    if (sameAsCurrent) return 'New password must be different from the current one.';
    return null;
  }, [tooShort, mismatch, sameAsCurrent]);

  const disabled =
    submitting ||
    currentPassword.length === 0 ||
    newPassword.length < MIN_PASSWORD_LENGTH ||
    newPassword !== confirmPassword ||
    newPassword === currentPassword;

  const reset = (): void => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = (): void => {
    if (submitting) return;
    reset();
    onClose();
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (disabled) return;
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password updated.');
      reset();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError
          ? err.detail || 'Could not update password.'
          : err instanceof Error
            ? err.message
            : 'Could not update password.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Change password"
      testId="change-password-modal"
      presentation="sheet"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
            data-testid="change-password-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            form="change-password-form"
            disabled={disabled}
            busy={submitting}
            data-testid="change-password-submit"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={onSubmit}>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoFocus
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="change-password-current"
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={tooShort || sameAsCurrent ? inlineError ?? undefined : undefined}
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="change-password-new"
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          error={mismatch ? 'New passwords do not match.' : undefined}
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="change-password-confirm"
        />
        {error !== null && (
          <p className="login-screen__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
};
