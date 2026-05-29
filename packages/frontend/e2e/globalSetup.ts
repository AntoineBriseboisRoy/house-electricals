/**
 * Playwright globalSetup (G21 cycle-21; Postgres since migrate/postgres).
 *
 * Spawns an ISOLATED backend on port 3100 pointed at the dev Postgres
 * (DATABASE_URL) but scoped to a dedicated `e2e` schema via DB_SCHEMA,
 * with DB_RESET=1 so the schema is dropped + recreated on every run for
 * a clean slate. FLOOR_PLAN_DIR still points at a fresh tmpdir (uploaded
 * images are filesystem state, not DB state). It waits for /api/v1/health,
 * then seeds fixtures via the public REST API (NEVER direct DB writes).
 *
 * Writes the runtime state (tmpdir path, backend pid, port) to
 * `e2e/.state.json` so globalTeardown can find + kill the backend and
 * rm the tmpdir.
 *
 * Hard rules:
 *  - This MUST NEVER touch the user's `public` schema — the `e2e` schema
 *    is fully isolated and the DB_RESET drop only ever names `e2e`.
 *  - This MUST NEVER touch `./data/` (the user's working data). The
 *    tmpdir convention is documented in CLAUDE.md "E2E (Playwright)".
 *  - Requires the dev Postgres to be reachable (docker compose -f
 *    docker-compose.dev.yml up -d). Point DATABASE_URL elsewhere for CI.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { seedFixtures, signupForSeed } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const BACKEND_DIR = join(WORKSPACE_ROOT, 'packages/backend');
const STATE_FILE = join(__dirname, '.state.json');
const AUTH_STORAGE_STATE_FILE = join(__dirname, '.auth.json');

const E2E_BACKEND_PORT = 3100;
const E2E_BACKEND_URL = `http://127.0.0.1:${E2E_BACKEND_PORT}`;

// The isolated backend talks to the dev Postgres but lands every table in a
// dedicated `e2e` schema (dropped + recreated on boot via DB_RESET) so it
// never collides with the operator's `public` data. Override DATABASE_URL to
// point at a CI / remote Postgres; the default mirrors test-helpers.ts.
const E2E_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/house_electricals';
const E2E_DB_SCHEMA = 'e2e';

const waitForBackend = async (
  baseUrl: string,
  timeoutMs: number
): Promise<void> => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // feat/auth-gate — use the unauthed /health endpoint;
      // /api/v1/panels now requires a cookie.
      const res = await fetch(`${baseUrl}/api/v1/health`);
      if (res.status === 200) return;
    } catch {
      // ECONNREFUSED while booting — keep polling.
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `[e2e globalSetup] backend on ${baseUrl} did not become ready within ${timeoutMs}ms`
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
};

const spawnBackend = (floorPlanDir: string): ChildProcess => {
  const isWin = process.platform === 'win32';
  // Use pnpm exec so we don't have to know where tsx is hoisted in the
  // workspace's node_modules. cwd is the backend package; tsx loads
  // src/index.ts (same entry the `dev` script uses).
  //
  // Windows .cmd shims require shell: true to spawn correctly (otherwise
  // Node 22 throws EINVAL — see nodejs/node#52554). POSIX keeps shell off.
  const cmd = isWin ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(cmd, ['exec', 'tsx', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      // Scope to the throw-away `e2e` schema and reset it on boot so each
      // run starts from a clean, fully-migrated slate.
      DB_SCHEMA: E2E_DB_SCHEMA,
      DB_RESET: '1',
      FLOOR_PLAN_DIR: floorPlanDir,
      HOST: '127.0.0.1',
      PORT: String(E2E_BACKEND_PORT),
      // Quiet the backend's own startup noise in CI logs (but keep errors).
      NODE_ENV: 'test',
      // feat/auth-gate (sign-up flow) — no AUTH_USERNAME/AUTH_PASSWORD
      // here; the test user is created via POST /auth/signup once the
      // backend is ready. See signupForSeed() below.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    // Spawn in a detached process group on POSIX so we can kill the whole
    // tree (pnpm wraps tsx wraps node). On Windows, we use taskkill /T in
    // teardown instead — see globalTeardown.ts.
    detached: !isWin,
    windowsHide: true,
  });

  child.stdout?.on('data', (buf) => {
    const line = buf.toString().trimEnd();
    if (line.length > 0) {
      console.log(`[backend] ${line}`);
    }
  });
  child.stderr?.on('data', (buf) => {
    const line = buf.toString().trimEnd();
    if (line.length > 0) {
      console.error(`[backend!] ${line}`);
    }
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[backend] exited with code=${code} signal=${signal}`);
    }
  });

  return child;
};

export default async function globalSetup(): Promise<void> {
  console.log('[e2e globalSetup] spawning isolated backend…');

  const tmp = mkdtempSync(join(tmpdir(), 'he-e2e-'));
  const floorPlanDir = join(tmp, 'floor-plans');
  mkdirSync(floorPlanDir, { recursive: true });

  console.log(`[e2e globalSetup] tmpdir = ${tmp}`);
  console.log(
    `[e2e globalSetup] DATABASE_URL = ${E2E_DATABASE_URL} (schema "${E2E_DB_SCHEMA}", reset on boot)`
  );
  console.log(`[e2e globalSetup] FLOOR_PLAN_DIR = ${floorPlanDir}`);

  const child = spawnBackend(floorPlanDir);
  if (child.pid === undefined) {
    throw new Error('[e2e globalSetup] backend child process has no pid');
  }

  // Persist state BEFORE the readiness probe so a hung backend still has a
  // pid in .state.json for teardown to kill.
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        tmpdir: tmp,
        pid: child.pid,
        port: E2E_BACKEND_PORT,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  try {
    await waitForBackend(E2E_BACKEND_URL, 30_000);
    console.log(`[e2e globalSetup] backend ready on ${E2E_BACKEND_URL}`);

    // feat/auth-gate (sign-up flow) — fresh backend has no user; mint
    // the e2e account once via /auth/signup. seedFixtures then logs in
    // with the same credentials. The cookie we'll write into
    // storageState comes from this initial signup response so every
    // spec starts pre-authed.
    const seedCookie = await signupForSeed(E2E_BACKEND_URL);

    const seeded = await seedFixtures(E2E_BACKEND_URL);
    console.log(
      `[e2e globalSetup] seeded: panel=${seeded.panelId} breakers=${seeded.breakerIds.length} floor=${seeded.floorId} components=${seeded.componentIds.length}`
    );

    // feat/auth-gate — write a Playwright storageState file with the
    // session cookie so every test starts pre-authenticated. Without
    // this, every spec would have to navigate to the login screen first.
    // The cookie is stored against the Vite-dev origin (127.0.0.1:5180);
    // Vite's proxy forwards it to the backend on /api/v1/* calls.
    const tokenValue = seedCookie.replace(/^he_auth=/, '');
    const storageState = {
      cookies: [
        {
          name: 'he_auth',
          value: tokenValue,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    };
    writeFileSync(
      AUTH_STORAGE_STATE_FILE,
      JSON.stringify(storageState, null, 2)
    );
    console.log(
      `[e2e globalSetup] wrote auth storageState → ${AUTH_STORAGE_STATE_FILE}`
    );

    // Re-write state with seeded ids for spec convenience.
    writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          tmpdir: tmp,
          pid: child.pid,
          port: E2E_BACKEND_PORT,
          startedAt: new Date().toISOString(),
          seeded,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error('[e2e globalSetup] failed during seed; killing backend');
    try {
      if (process.platform === 'win32') {
        // best-effort
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      // ignore
    }
    throw err;
  }
}
