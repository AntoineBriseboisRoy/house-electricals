import { sign } from 'hono/jwt';
import type { AuthConfig } from './auth.js';

/**
 * Auth config used across the backend auth-specific tests. Pinned so
 * tests can sign tokens directly without touching env vars. The
 * username + password are NOT stored here — they live in the
 * `app_users` table; tests that need a credentialed user seed it via
 * the repository in their own setup.
 */
export const TEST_AUTH: AuthConfig = {
  secret: 'test-secret-not-used-in-production-just-for-deterministic-tests',
};

/** Test username pinned across the auth suite. Real password hashes
 *  are seeded per-test via `hashPassword(...)`. */
export const TEST_USERNAME = 'test-user';
export const TEST_PASSWORD = 'test-password';

/** Build a valid `he_auth` cookie value for the test user. */
export const testAuthCookie = async (
  sub: string = TEST_USERNAME
): Promise<string> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub, iat: nowSec, exp: nowSec + 3600 },
    TEST_AUTH.secret
  );
  return `he_auth=${token}`;
};

/** Shorthand to attach the auth cookie + JSON content-type to a test
 *  request. */
export const authedHeaders = async (
  extra?: Record<string, string>
): Promise<Record<string, string>> => ({
  cookie: await testAuthCookie(),
  ...(extra ?? {}),
});
