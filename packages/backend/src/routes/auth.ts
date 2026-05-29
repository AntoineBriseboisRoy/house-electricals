import { Hono, type Context } from 'hono';
import { sign } from 'hono/jwt';
import { deleteCookie, setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import {
  z,
  changePasswordInputSchema,
  signupInputSchema,
  type AppUserRepository,
  type ApiEnvelope,
  type ApiError,
} from '@he/shared';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_MAX_AGE_SECONDS,
  type AuthConfig,
} from '../auth.js';
import { hashPassword, verifyPassword } from '../password.js';

const loginInputSchema = z
  .object({
    username: z.string().min(1).max(120),
    password: z.string().min(1).max(512),
  })
  .strict();

const issueSessionCookie = async (
  c: Context,
  cfg: AuthConfig,
  username: string
): Promise<string> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: username, iat: nowSec, exp: nowSec + AUTH_TOKEN_MAX_AGE_SECONDS },
    cfg.secret
  );
  // httpOnly + SameSite=Lax + Path=/. NO Secure flag — the operator's
  // reverse proxy handles TLS termination; the cookie still works over
  // plain HTTP on localhost / LAN.
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
  });
  return token;
};

/**
 * Public auth subroutes — mounted BEFORE the JWT middleware so they're
 * reachable to unauthed clients.
 *
 *   POST /auth/signup          — first-user setup. 409 if any user exists.
 *   POST /auth/login           — username + password → cookie.
 *   POST /auth/logout          — clears the cookie.
 *   GET  /auth/setup-status    — { needsSetup: boolean }. Drives the
 *                                frontend's sign-up vs login pivot.
 */
export const buildPublicAuthRoutes = (
  cfg: AuthConfig,
  users: AppUserRepository
): Hono => {
  const router = new Hono();

  router.get('/auth/setup-status', async (c) => {
    const body: ApiEnvelope<{ needsSetup: boolean }> = {
      data: { needsSetup: !(await users.hasAnyUser()) },
    };
    return c.json(body, 200);
  });

  router.post(
    '/auth/signup',
    zValidator('json', signupInputSchema, (result, c) => {
      if (!result.success) {
        const message = result.error.issues[0]?.message ?? 'Invalid sign-up body.';
        const err: ApiError = { error: { message } };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      if (await users.hasAnyUser()) {
        const err: ApiError = {
          error: { message: 'Setup is already complete. Sign in instead.' },
        };
        return c.json(err, 409);
      }
      const { username, password } = c.req.valid('json');
      const passwordHash = await hashPassword(password);
      let created;
      try {
        created = await users.create({ username, passwordHash });
      } catch {
        // Race: another sign-up landed between hasAnyUser() and create().
        const err: ApiError = {
          error: { message: 'Setup is already complete. Sign in instead.' },
        };
        return c.json(err, 409);
      }
      await issueSessionCookie(c, cfg, created.username);
      const body: ApiEnvelope<{ username: string }> = {
        data: { username: created.username },
      };
      return c.json(body, 201);
    }
  );

  router.post(
    '/auth/login',
    zValidator('json', loginInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = { error: { message: 'Invalid login body.' } };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const { username, password } = c.req.valid('json');
      const user = await users.getByUsername(username);
      // Always run a scrypt verify so the wrong-username and
      // wrong-password paths take comparable time. We hash against a
      // throw-away placeholder when the user doesn't exist.
      const encoded =
        user?.passwordHash ??
        // A deterministic placeholder so we still consume CPU even on
        // wrong-username; verifyPassword will return false.
        'scrypt$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const ok = await verifyPassword(password, encoded);
      if (!ok || user === null) {
        const err: ApiError = {
          error: { message: 'Invalid username or password.' },
        };
        return c.json(err, 401);
      }
      await issueSessionCookie(c, cfg, user.username);
      const body: ApiEnvelope<{ username: string }> = {
        data: { username: user.username },
      };
      return c.json(body, 200);
    }
  );

  // Logout is public-safe (clearing a cookie with no auth = no-op for
  // anyone who isn't authed, success for those who are).
  router.post('/auth/logout', (c) => {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  return router;
};

/**
 * Authed-only subroutes — `/auth/me` + `/auth/password`. Mounted AFTER
 * the JWT middleware so they can read `jwtPayload` from context.
 */
export const buildProtectedAuthRoutes = (
  users: AppUserRepository
): Hono => {
  const router = new Hono();

  router.get('/auth/me', (c) => {
    const payload = c.get('jwtPayload') as { sub?: string } | undefined;
    if (payload === undefined || typeof payload.sub !== 'string') {
      const err: ApiError = { error: { message: 'Unauthenticated.' } };
      return c.json(err, 401);
    }
    const body: ApiEnvelope<{ username: string }> = {
      data: { username: payload.sub },
    };
    return c.json(body, 200);
  });

  router.patch(
    '/auth/password',
    zValidator('json', changePasswordInputSchema, (result, c) => {
      if (!result.success) {
        const message =
          result.error.issues[0]?.message ?? 'Invalid change-password body.';
        const err: ApiError = { error: { message } };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const payload = c.get('jwtPayload') as { sub?: string } | undefined;
      if (payload === undefined || typeof payload.sub !== 'string') {
        const err: ApiError = { error: { message: 'Unauthenticated.' } };
        return c.json(err, 401);
      }
      const user = await users.getByUsername(payload.sub);
      if (user === null) {
        // Token was signed for a username that no longer exists in the
        // DB — treat as unauthed.
        const err: ApiError = { error: { message: 'Unauthenticated.' } };
        return c.json(err, 401);
      }
      const { currentPassword, newPassword } = c.req.valid('json');
      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) {
        const err: ApiError = {
          error: { message: 'Current password is incorrect.' },
        };
        return c.json(err, 401);
      }
      const newHash = await hashPassword(newPassword);
      await users.updatePasswordHash(user.id, newHash);
      return c.body(null, 204);
    }
  );

  return router;
};
