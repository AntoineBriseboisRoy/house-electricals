import { sign } from 'hono/jwt';
import { newId } from '@he/shared';
import type { AppUserRepository } from '@he/shared';
import type { Hono } from 'hono';
import type { AuthConfig } from './auth.js';
import { Db, createPool } from './db.js';
import {
  initSchema,
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
} from './repository.js';
import { buildApp } from './server.js';

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

// ── Postgres test harness ──────────────────────────────────────────────
//
// Each suite gets its OWN schema (`test_<ulid>`) inside one shared Postgres
// database, so suites are fully isolated without a database-per-test. The
// schema is scoped via the pg connection `options: -c search_path=<schema>`
// (see `createPool`), so all unqualified DDL/DML in `initSchema` + the
// repositories lands in the isolated schema.
//
// Connection string: `DATABASE_URL` env var, falling back to the local
// docker-compose dev database. Point `DATABASE_URL` at any reachable
// Postgres to run the suite elsewhere (CI, a remote box, etc).

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/house_electricals';

export interface TestDb {
  /** Migrated, schema-isolated handle the repositories consume. */
  db: Db;
  /** The throw-away schema name (`test_<ulid>`). */
  schema: string;
  /** Drop the schema (CASCADE) and close the pool. Idempotent. */
  cleanup(): Promise<void>;
}

/**
 * Spin up an isolated, fully-migrated Postgres schema and return a `Db`
 * scoped to it. Caller MUST `await cleanup()` (typically in `afterEach`).
 */
export const createTestDb = async (): Promise<TestDb> => {
  // ULIDs are Crockford base32 (alphanumeric, no separators); lowercase so
  // the unquoted identifier matches Postgres' default case-folding.
  const schema = `test_${newId().toLowerCase()}`;
  // Small pool — many suites run in the same Postgres and the default
  // max_connections is 100; keep each suite's footprint low.
  const pool = createPool(TEST_DATABASE_URL, { schema, max: 4 });
  const db = new Db(pool);
  // CREATE SCHEMA is explicit (names the schema), so it works even though
  // the connection's search_path already points at the not-yet-existing
  // schema. Everything `initSchema` creates then lands inside it.
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await initSchema(db);

  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await db.close();
    }
  };

  return { db, schema, cleanup };
};

/**
 * Wire a full `buildApp` with every Pg repository pointed at `db`. The
 * route-level test suites all need the same 8-repository config; this
 * hoists it to one place so each suite is just
 * `app = buildTestApp(t.db)` in `beforeEach`.
 *
 * `auth`/`appUserRepository` default to `null` (the test-bypass mode —
 * no JWT gate, cookie-free `app.request(...)`). The auth suite passes
 * real values via `overrides` to exercise the gate.
 */
export interface TestAppOverrides {
  auth?: AuthConfig | null;
  appUserRepository?: AppUserRepository | null;
}

export const buildTestApp = (
  db: Db,
  overrides: TestAppOverrides = {}
): Hono =>
  buildApp({
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
    appUserRepository: overrides.appUserRepository ?? null,
    auth: overrides.auth ?? null,
  });
