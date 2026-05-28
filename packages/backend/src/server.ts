import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ApiError,
  AppUserRepository,
  BreakerRepository,
  BreakerTestRepository,
  ComponentRepository,
  FloorRepository,
  PanelRepository,
  RoomRepository,
  ServiceEntryRepository,
  WallRepository,
} from '@he/shared';
import { buildPanelRoutes } from './routes/panels.js';
import { buildBreakerRoutes } from './routes/breakers.js';
import { buildBreakerTestRoutes } from './routes/breaker-tests.js';
import { buildComponentRoutes } from './routes/components.js';
import { buildFloorPlanRoutes } from './routes/floor-plans.js';
import { buildFloorRoutes } from './routes/floors.js';
import { buildRoomRoutes } from './routes/rooms.js';
import { buildServiceEntryRoutes } from './routes/service-entries.js';
import { buildWallRoutes } from './routes/walls.js';
import { buildSwitchControlRoutes } from './routes/switch-controls.js';
import { devStaticRoutes } from './routes/dev-static.js';
import { healthRoutes } from './routes/health.js';
import { spaRoutes } from './routes/static-spa.js';
import {
  buildProtectedAuthRoutes,
  buildPublicAuthRoutes,
} from './routes/auth.js';
import { AUTH_COOKIE_NAME, type AuthConfig } from './auth.js';

export type AppDeps = {
  panelRepository: PanelRepository;
  breakerRepository: BreakerRepository;
  /** G36 cycle-61 — audit-trail repo (breaker_tests). */
  breakerTestRepository: BreakerTestRepository;
  componentRepository: ComponentRepository;
  floorRepository: FloorRepository;
  wallRepository: WallRepository;
  roomRepository: RoomRepository;
  /** G40 cycle-66 — dated service-log repo (service_entries). */
  serviceEntryRepository: ServiceEntryRepository;
  /** Raw DB handle — switch_controls is a thin join table, easier to
   *  query directly than via a full repo class for G19 scope. */
  db: DatabaseSync;
  /** feat/auth-gate (sign-up flow) — single-user account table. The
   *  JWT-protected auth routes read this; sign-up writes the (one)
   *  row. May be null in tests that don't exercise auth. */
  appUserRepository: AppUserRepository | null;
  /** feat/auth-gate — single-user JWT-cookie auth config. When null,
   *  the JWT middleware + auth routes are NOT mounted. Production passes
   *  a real config (loaded from env in `index.ts`); tests pass `null` so
   *  they don't need to mint cookies for every `app.request(...)` call.
   *  The auth logic itself has its own dedicated `auth.test.ts`. */
  auth: AuthConfig | null;
};

export const buildApp = (deps: AppDeps): Hono => {
  const app = new Hono();

  // ── PUBLIC ROUTES ────────────────────────────────────────────────────
  // Health stays open so reverse-proxy / monitoring probes work without
  // credentials.
  app.route('/api/v1', healthRoutes);

  // ── AUTH (opt-in) ────────────────────────────────────────────────────
  // Production always passes a real `deps.auth` + `deps.appUserRepository`;
  // tests pass null to bypass the gate and keep the `app.request(...)`
  // calls cookie-free.
  if (deps.auth !== null && deps.appUserRepository !== null) {
    const users = deps.appUserRepository;
    // Sign-up, login, logout, setup-status are public — mounted BEFORE
    // the JWT middleware.
    app.route('/api/v1', buildPublicAuthRoutes(deps.auth, users));
    // Every other /api/v1/* path requires a valid `he_auth` cookie.
    // Returns JSON 401 on missing/invalid token so the frontend pivots
    // to the login screen cleanly. /files/* and /* (SPA assets) stay
    // UNGATED at the HTTP layer — the SPA itself decides what to render
    // based on /auth/me + /auth/setup-status, and floor-plan filenames
    // are 8-char content hashes so unauth scraping is impractical.
    app.use(
      '/api/v1/*',
      jwt({
        secret: deps.auth.secret,
        cookie: AUTH_COOKIE_NAME,
        alg: 'HS256',
      })
    );
    // Hono's JWT middleware throws an HTTPException with a
    // `WWW-Authenticate` header on unauth; intercept to return the
    // standard `{error:{message}}` envelope that the frontend already
    // handles.
    app.onError((err, c) => {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        const body: ApiError = { error: { message: 'Unauthenticated.' } };
        return c.json(body, 401);
      }
      throw err;
    });
    // /auth/me + /auth/password sit inside the JWT gate.
    app.route('/api/v1', buildProtectedAuthRoutes(users));
  }

  // ── PROTECTED API ROUTES ─────────────────────────────────────────────
  app.route(
    '/api/v1',
    buildPanelRoutes(deps.panelRepository, deps.breakerRepository)
  );
  app.route(
    '/api/v1',
    buildBreakerRoutes(deps.panelRepository, deps.breakerRepository)
  );
  app.route(
    '/api/v1',
    buildBreakerTestRoutes(deps.breakerRepository, deps.breakerTestRepository)
  );
  app.route(
    '/api/v1',
    buildComponentRoutes(deps.componentRepository, deps.breakerRepository)
  );
  app.route('/api/v1', buildFloorPlanRoutes(deps.floorRepository));
  app.route(
    '/api/v1',
    buildFloorRoutes(deps.floorRepository, deps.panelRepository)
  );
  app.route('/api/v1', buildWallRoutes(deps.wallRepository, deps.floorRepository));
  app.route('/api/v1', buildRoomRoutes(deps.roomRepository, deps.floorRepository));
  app.route(
    '/api/v1',
    buildServiceEntryRoutes(
      deps.breakerRepository,
      deps.componentRepository,
      deps.serviceEntryRepository
    )
  );
  app.route(
    '/api/v1',
    buildSwitchControlRoutes(deps.db, deps.componentRepository)
  );

  // ── UNGATED static serving (intentional) ─────────────────────────────
  // `/files/floor-plans/:filename` — uploaded floor-plan images. Same
  // caveat as before: filenames are 8-char content hashes so unauth
  // discovery is impractical.
  app.route('/', devStaticRoutes);
  // SPA + static asset serving for the Vite-built frontend. MUST be
  // registered last so /api/v1/* and /files/* match first.
  app.route('/', spaRoutes);
  return app;
};
