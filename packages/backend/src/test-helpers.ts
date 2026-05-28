import { sign } from 'hono/jwt';
import type { AuthConfig } from './auth.js';

/**
 * Auth config used across all backend tests. Pinned values so tests
 * can sign tokens directly without touching env vars.
 */
export const TEST_AUTH: AuthConfig = {
  username: 'test-user',
  password: 'test-password',
  secret: 'test-secret-not-used-in-production-just-for-deterministic-tests',
};

/** Build a valid `he_auth` cookie value for the test user. */
export const testAuthCookie = async (): Promise<string> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: TEST_AUTH.username, iat: nowSec, exp: nowSec + 3600 },
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
