import { serve } from '@hono/node-server';
import { Db, createPool } from './db.js';
import {
  PgAppUserRepository,
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
} from './repository.js';
import { buildApp } from './server.js';
import { loadAuthConfig } from './auth.js';

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Optional Postgres schema scoping. When set, every connection is pinned to
// this schema via `search_path` (see createPool) and `initSchema` creates
// its tables inside it. This lets one Postgres host several isolated app
// instances, and is how the e2e harness keeps its fixtures out of the dev
// `public` schema. The value is interpolated into DDL (Postgres can't
// parameterize identifiers), so it is validated against a strict pattern.
const DB_SCHEMA = process.env.DB_SCHEMA?.trim();
// TEST-ONLY: when truthy AND DB_SCHEMA is set, the named schema is dropped
// (CASCADE) on boot before being recreated — a clean slate for each e2e run.
// NEVER set this in production; it destroys every table in DB_SCHEMA.
const DB_RESET = /^(1|true|yes)$/i.test(process.env.DB_RESET ?? '');

const SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]*$/;

if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  console.error(
    '[backend] DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)'
  );
  process.exit(1);
}

if (
  DB_SCHEMA !== undefined &&
  DB_SCHEMA.length > 0 &&
  !SCHEMA_NAME_RE.test(DB_SCHEMA)
) {
  console.error(
    `[backend] DB_SCHEMA must match ${String(SCHEMA_NAME_RE)} (got: ${DB_SCHEMA})`
  );
  process.exit(1);
}

const main = async (): Promise<void> => {
  // feat/auth-gate — load (or auto-generate) the JWT signing secret.
  // Credentials themselves live in the `app_users` table — first boot
  // lands users on the sign-up screen via /auth/setup-status.
  const auth = loadAuthConfig();

  const hasSchema = DB_SCHEMA !== undefined && DB_SCHEMA.length > 0;
  const pool = createPool(
    DATABASE_URL,
    hasSchema ? { schema: DB_SCHEMA } : {}
  );
  const db = new Db(pool);

  if (hasSchema) {
    // CREATE/DROP SCHEMA name the schema explicitly, so they work even though
    // the connection's search_path already points at the (possibly not-yet-
    // existing) schema — same pattern as the test harness's createTestDb.
    if (DB_RESET) {
      console.warn(`[backend] DB_RESET set — dropping schema "${DB_SCHEMA}"`);
      await db.exec(`DROP SCHEMA IF EXISTS ${DB_SCHEMA} CASCADE`);
    }
    await db.exec(`CREATE SCHEMA IF NOT EXISTS ${DB_SCHEMA}`);
    console.log(`[backend] using Postgres schema "${DB_SCHEMA}"`);
  }

  await initSchema(db);

  const buildingRepository = new PgBuildingRepository(db);
  const panelRepository = new PgPanelRepository(db);
  const breakerRepository = new PgBreakerRepository(db);
  const breakerTestRepository = new PgBreakerTestRepository(db);
  const componentRepository = new PgComponentRepository(db);
  const floorRepository = new PgFloorRepository(db);
  const wallRepository = new PgWallRepository(db);
  const roomRepository = new PgRoomRepository(db);
  const serviceEntryRepository = new PgServiceEntryRepository(db);
  const attachmentRepository = new PgAttachmentRepository(db);
  const appUserRepository = new PgAppUserRepository(db);
  const app = buildApp({
    buildingRepository,
    panelRepository,
    breakerRepository,
    breakerTestRepository,
    componentRepository,
    floorRepository,
    wallRepository,
    roomRepository,
    serviceEntryRepository,
    attachmentRepository,
    db,
    appUserRepository,
    auth,
  });

  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[backend] received ${signal}, shutting down`);
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const tz = process.env.TZ?.trim();
  console.log(
    `[backend] timezone: ${tz && tz.length > 0 ? tz : '(unset — clients use device-local time)'}`
  );
  console.log(`[backend] listening on http://${HOST}:${PORT}`);
};

main().catch((err: unknown) => {
  console.error('[backend] fatal startup error', err);
  process.exit(1);
});
