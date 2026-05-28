import { useState, type FormEvent } from 'react';
import { Lock, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { ApiHttpError } from '../api.js';
import { Button, Input } from '../ui/index.js';

/**
 * feat/auth-gate — login screen.
 *
 * Rendered by App.tsx when `state.phase === 'unauthed'`. On successful
 * login the AuthContext flips to `authed` and App.tsx re-renders the
 * normal AppShell automatically.
 *
 * The card stays narrow + centered (mobile-friendly default) and
 * inherits the cycle-23 theme tokens so light + dark modes both work.
 */
export const LoginScreen = (): JSX.Element => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError
          ? err.detail || 'Invalid username or password.'
          : err instanceof Error
            ? err.message
            : 'Failed to sign in.';
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
        aria-labelledby="login-title"
      >
        <h1 id="login-title" className="login-screen__title">
          House Electricals
        </h1>
        <p className="login-screen__subtitle">Sign in to continue.</p>

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
          data-testid="login-username"
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          leadingIcon={<Lock size={16} strokeWidth={2.25} />}
          data-testid="login-password"
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
          disabled={
            submitting || username.trim().length === 0 || password.length === 0
          }
          busy={submitting}
          data-testid="login-submit"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
};
