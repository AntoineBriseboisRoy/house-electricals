import { useMemo, useState, type FormEvent } from 'react';
import { Lock, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { ApiHttpError } from '../api.js';
import { Button, Input } from '../ui/index.js';

const MIN_PASSWORD_LENGTH = 8;

/**
 * feat/auth-gate (sign-up flow) — first-time setup screen.
 *
 * Rendered by App.tsx when `state.phase === 'needs-setup'` (the
 * backend's app_users table is empty). On submit, POSTs to
 * /api/v1/auth/signup; the server creates the (one and only) user row,
 * auto-logs us in via Set-Cookie, and the AuthContext transitions to
 * `authed` — App.tsx then renders the normal AppShell.
 *
 * Single-user model: this screen is reachable EXACTLY ONCE per
 * deployment. Subsequent visits go straight to LoginScreen.
 */
export const SignupScreen = (): JSX.Element => {
  const { signup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedUsername = username.trim();
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const inlineHint = useMemo<string | null>(() => {
    if (passwordTooShort) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (passwordsMismatch) {
      return 'Passwords do not match.';
    }
    return null;
  }, [passwordTooShort, passwordsMismatch]);

  const disabled =
    submitting ||
    trimmedUsername.length === 0 ||
    password.length < MIN_PASSWORD_LENGTH ||
    password !== confirmPassword;

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (disabled) return;
    setError(null);
    setSubmitting(true);
    try {
      await signup(trimmedUsername, password);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError
          ? err.detail || 'Sign-up failed.'
          : err instanceof Error
            ? err.message
            : 'Sign-up failed.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen" role="main">
      <form
        className="login-screen__card"
        onSubmit={onSubmit}
        aria-labelledby="signup-title"
      >
        <h1 id="signup-title" className="login-screen__title">
          House Electricals
        </h1>
        <p className="login-screen__subtitle">
          Welcome — create your account to get started.
        </p>

        <Input
          label="Username"
          type="text"
          autoComplete="username"
          inputMode="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
          leadingIcon={<User size={16} strokeWidth={2.25} />}
          data-testid="signup-username"
        />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={passwordTooShort ? inlineHint ?? undefined : undefined}
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="signup-password"
        />

        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          error={passwordsMismatch ? 'Passwords do not match.' : undefined}
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="signup-confirm"
        />

        {error !== null && (
          <p className="login-screen__error" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          block
          disabled={disabled}
          busy={submitting}
          data-testid="signup-submit"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </div>
  );
};
