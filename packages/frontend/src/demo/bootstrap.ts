/**
 * Demo bootstrap — runs the REAL Hono backend in the browser.
 *
 * Pipeline (called once, before React renders, from main.demo.tsx):
 *   1. createDemoDb()  — PGlite-backed `Db`
 *   2. initSchema(db)  — the real DDL (also seeds the default "My House")
 *   3. construct every Pg*Repository from that db
 *   4. buildApp({ ..., auth: null, appUserRepository: null }) — no-auth mode
 *   5. seedDemo(app)   — sample data via the real routes
 *   6. install a window.fetch interceptor that routes /api/v1/* into app.fetch
 *
 * Everything except `createDemoDb` is the actual production backend, so the
 * demo can never drift from the shipped app.
 */
import { createDemoDb } from './pglite-pool.js';
import {
  PgAttachmentRepository,
  PgBreakerRepository,
  PgBreakerTestRepository,
  PgBuildingRepository,
  PgComponentRepository,
  PgFloorRepository,
  PgPanelRepository,
  PgRoomRepository,
  PgServiceEntryRepository,
  PgWallRepository,
  initSchema,
} from '../../../backend/src/repository.js';
import { buildApp } from '../../../backend/src/server.js';
import { seedDemo } from './seed.js';

type FetchApp = { fetch: (req: Request) => Promise<Response> };

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * The frontend's AuthContext probes /auth/setup-status + /auth/me on mount.
 * The demo app is built with `auth: null`, so those routes aren't mounted —
 * we answer them here so the app presents as a logged-in "demo" user instead
 * of bouncing to the login/signup screen. This is the ONLY behavior-shaping
 * demo glue; no product route/repo/schema is forked.
 */
const cannedAuth = (pathname: string): Response | null => {
  if (!pathname.startsWith('/api/v1/auth/')) return null;
  switch (pathname) {
    case '/api/v1/auth/setup-status':
      return jsonResponse({ data: { needsSetup: false } });
    case '/api/v1/auth/me':
    case '/api/v1/auth/login':
      return jsonResponse({ data: { username: 'demo' } });
    case '/api/v1/auth/logout':
      return new Response(null, { status: 200 });
    case '/api/v1/auth/password':
      return new Response(null, { status: 204 });
    default:
      return jsonResponse({ error: { message: 'Not available in the demo.' } }, 404);
  }
};

const installFetchInterceptor = (app: FetchApp): void => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const req =
      input instanceof Request && init === undefined
        ? input
        : new Request(input, init);
    const { pathname } = new URL(req.url, window.location.origin);
    if (pathname.startsWith('/api/v1/')) {
      return cannedAuth(pathname) ?? app.fetch(req);
    }
    // Everything else (hashed assets, fonts, GoatCounter) → the network.
    return nativeFetch(input as RequestInfo, init);
  };
};

let started: Promise<void> | null = null;

export const start = (): Promise<void> => {
  if (started !== null) return started;
  started = (async () => {
    const db = await createDemoDb();
    await initSchema(db);

    const app = buildApp({
      buildingRepository: new PgBuildingRepository(db),
      panelRepository: new PgPanelRepository(db),
      breakerRepository: new PgBreakerRepository(db),
      breakerTestRepository: new PgBreakerTestRepository(db),
      componentRepository: new PgComponentRepository(db),
      floorRepository: new PgFloorRepository(db),
      wallRepository: new PgWallRepository(db),
      roomRepository: new PgRoomRepository(db),
      serviceEntryRepository: new PgServiceEntryRepository(db),
      attachmentRepository: new PgAttachmentRepository(db),
      db,
      appUserRepository: null,
      auth: null,
    });

    await seedDemo(app);
    installFetchInterceptor(app);
  })();
  return started;
};
