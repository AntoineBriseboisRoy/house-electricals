import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import {
  SqliteAppUserRepository,
  SqliteBreakerRepository,
  SqliteBreakerTestRepository,
  SqliteComponentRepository,
  SqliteFloorRepository,
  SqlitePanelRepository,
  SqliteRoomRepository,
  SqliteServiceEntryRepository,
  SqliteWallRepository,
  openDatabase,
} from './repository.js';
import { buildApp } from './server.js';
import { loadAuthConfig } from './auth.js';

const DB_PATH = process.env.DB_PATH ?? '/data/panels.db';
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

mkdirSync(dirname(DB_PATH), { recursive: true });

// feat/auth-gate — load (or auto-generate) the JWT signing secret.
// Credentials themselves live in the `app_users` SQLite table — first
// boot lands users on the sign-up screen via /auth/setup-status.
const auth = loadAuthConfig();

const db = openDatabase(DB_PATH);
const panelRepository = new SqlitePanelRepository(db);
const breakerRepository = new SqliteBreakerRepository(db);
const breakerTestRepository = new SqliteBreakerTestRepository(db);
const componentRepository = new SqliteComponentRepository(db);
const floorRepository = new SqliteFloorRepository(db);
const wallRepository = new SqliteWallRepository(db);
const roomRepository = new SqliteRoomRepository(db);
const serviceEntryRepository = new SqliteServiceEntryRepository(db);
const appUserRepository = new SqliteAppUserRepository(db);
const app = buildApp({
  panelRepository,
  breakerRepository,
  breakerTestRepository,
  componentRepository,
  floorRepository,
  wallRepository,
  roomRepository,
  serviceEntryRepository,
  db,
  appUserRepository,
  auth,
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });

const shutdown = (signal: string): void => {
  console.log(`[backend] received ${signal}, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[backend] listening on http://${HOST}:${PORT} (db ${DB_PATH})`);
