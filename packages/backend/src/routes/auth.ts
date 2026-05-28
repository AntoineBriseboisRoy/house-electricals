import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { deleteCookie, setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from '@he/shared';
import type { ApiEnvelope, ApiError } from '@he/shared';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_MAX_AGE_SECONDS,
  verifyCredentials,
  type AuthConfig,
} from '../auth.js';

const loginInputSchema = z
  .object({
    username: z.string().min(1).max(120),
    password: z.string().min(1).max(512),
  })
  .strict();

/**
 * Public auth subroutes — login + logout. Mounted BEFORE the JWT
 * middleware so the endpoints are reachable to unauthed clients.
 */
export const buildPublicAuthRoutes = (cfg: AuthConfig): Hono => {
  const router = new Hono();

  router.post(
    '/auth/login',
    zValidator('json', loginInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: 'Invalid login body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const { username, password } = c.req.valid('json');
      if (!verifyCredentials(cfg, username, password)) {
        const err: ApiError = {
          error: { message: 'Invalid username or password.' },
        };
        return c.json(err, 401);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await sign(
        {
          sub: cfg.username,
          iat: nowSec,
          exp: nowSec + AUTH_TOKEN_MAX_AGE_SECONDS,
        },
        cfg.secret
      );
      // httpOnly + SameSite=Lax + Path=/. NO Secure flag — the
      // operator's reverse proxy handles TLS termination; the cookie
      // still works over plain HTTP on localhost / LAN.
      setCookie(c, AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
      });
      const body: ApiEnvelope<{ username: string }> = {
        data: { username: cfg.username },
      };
      return c.json(body, 200);
    }
  );

  // Logout is public-safe (clearing a cookie with no auth = no-op
  // for anyone who isn't authed, success for those who are).
  router.post('/auth/logout', (c) => {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  return router;
};

/**
 * Authed-only subroutes — `/auth/me`. Mounted AFTER the JWT
 * middleware so it can read `jwtPayload` from context.
 */
export const buildProtectedAuthRoutes = (): Hono => {
  const router = new Hono();

  router.get('/auth/me', (c) => {
    const payload = c.get('jwtPayload') as
      | { sub?: string }
      | undefined;
    if (payload === undefined || typeof payload.sub !== 'string') {
      const err: ApiError = { error: { message: 'Unauthenticated.' } };
      return c.json(err, 401);
    }
    const body: ApiEnvelope<{ username: string }> = {
      data: { username: payload.sub },
    };
    return c.json(body, 200);
  });

  return router;
};
