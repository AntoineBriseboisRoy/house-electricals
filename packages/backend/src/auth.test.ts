import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  SqliteAppUserRepository,
  SqliteBreakerRepository,
  SqliteBreakerTestRepository,
  SqliteComponentRepository,
  SqliteFloorRepository,
  SqlitePanelRepository,
  SqliteRoomRepository,
  SqliteServiceEntryRepository,
  SqliteWallRepository,
} from './repository.js';
import { buildApp } from './server.js';
import { hashPassword } from './password.js';
import {
  TEST_AUTH,
  TEST_PASSWORD,
  TEST_USERNAME,
  testAuthCookie,
} from './test-helpers.js';

const buildAuthedApp = (
  db: DatabaseSync
): ReturnType<typeof buildApp> => {
  return buildApp({
    panelRepository: new SqlitePanelRepository(db),
    breakerRepository: new SqliteBreakerRepository(db),
    breakerTestRepository: new SqliteBreakerTestRepository(db),
    componentRepository: new SqliteComponentRepository(db),
    floorRepository: new SqliteFloorRepository(db),
    wallRepository: new SqliteWallRepository(db),
    roomRepository: new SqliteRoomRepository(db),
    serviceEntryRepository: new SqliteServiceEntryRepository(db),
    db,
    appUserRepository: new SqliteAppUserRepository(db),
    auth: TEST_AUTH,
  });
};

/** Seed the canonical test user (username + scrypt hash of TEST_PASSWORD). */
const seedTestUser = async (db: DatabaseSync): Promise<void> => {
  const users = new SqliteAppUserRepository(db);
  const passwordHash = await hashPassword(TEST_PASSWORD);
  users.create({ username: TEST_USERNAME, passwordHash });
};

describe('auth gate (feat/auth-gate + sign-up flow)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-auth-'));
    db = openDatabase(join(dir, 's.db'));
    app = buildAuthedApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /api/v1/auth/setup-status', () => {
    it('returns { needsSetup: true } when the user table is empty', async () => {
      const r = await app.request('/api/v1/auth/setup-status');
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: { needsSetup: boolean } };
      assert.equal(body.data.needsSetup, true);
    });

    it('returns { needsSetup: false } after a user is seeded', async () => {
      await seedTestUser(db);
      const r = await app.request('/api/v1/auth/setup-status');
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: { needsSetup: boolean } };
      assert.equal(body.data.needsSetup, false);
    });
  });

  describe('POST /api/v1/auth/signup', () => {
    it('creates the first user, returns 201 + sets cookie', async () => {
      const r = await app.request('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'first-user',
          password: 'strong-password',
        }),
      });
      assert.equal(r.status, 201);
      const setCookie = r.headers.get('set-cookie') ?? '';
      assert.ok(setCookie.includes('he_auth='));
      assert.ok(setCookie.toLowerCase().includes('httponly'));
      const body = (await r.json()) as { data: { username: string } };
      assert.equal(body.data.username, 'first-user');
    });

    it('rejects sign-up when a user already exists (409)', async () => {
      await seedTestUser(db);
      const r = await app.request('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'second-user',
          password: 'another-strong',
        }),
      });
      assert.equal(r.status, 409);
      assert.equal(r.headers.get('set-cookie'), null);
    });

    it('rejects short passwords with 400', async () => {
      const r = await app.request('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'u', password: 'short' }),
      });
      assert.equal(r.status, 400);
    });

    it('rejects empty username with 400', async () => {
      const r = await app.request('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '   ', password: 'ok-password' }),
      });
      assert.equal(r.status, 400);
    });
  });

  describe('POST /api/v1/auth/login (DB-backed)', () => {
    beforeEach(async () => {
      await seedTestUser(db);
    });

    it('accepts correct credentials + sets cookie', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });
      assert.equal(r.status, 200);
      const setCookie = r.headers.get('set-cookie') ?? '';
      assert.ok(setCookie.includes('he_auth='));
      assert.ok(setCookie.toLowerCase().includes('httponly'));
      assert.ok(setCookie.toLowerCase().includes('samesite=lax'));
    });

    it('rejects wrong password with 401', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: 'wrong-password',
        }),
      });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get('set-cookie'), null);
    });

    it('rejects wrong username with 401', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'nobody',
          password: TEST_PASSWORD,
        }),
      });
      assert.equal(r.status, 401);
    });

    it('rejects malformed body with 400', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '' }),
      });
      assert.equal(r.status, 400);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 204 and clears the cookie', async () => {
      const r = await app.request('/api/v1/auth/logout', { method: 'POST' });
      assert.equal(r.status, 204);
      const setCookie = (r.headers.get('set-cookie') ?? '').toLowerCase();
      assert.ok(
        setCookie.includes('max-age=0') || setCookie.includes('expires='),
        'logout should clear cookie via Max-Age=0 or Expires'
      );
    });
  });

  describe('protected routes (auth required)', () => {
    beforeEach(async () => {
      await seedTestUser(db);
    });

    it('GET /api/v1/panels without cookie → 401 JSON', async () => {
      const r = await app.request('/api/v1/panels');
      assert.equal(r.status, 401);
      const body = (await r.json()) as { error?: { message?: string } };
      assert.equal(typeof body.error?.message, 'string');
    });

    it('GET /api/v1/panels WITH valid cookie → 200', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/panels', { headers: { cookie } });
      assert.equal(r.status, 200);
    });

    it('GET /api/v1/auth/me returns username for a valid cookie', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/auth/me', {
        headers: { cookie },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: { username: string } };
      assert.equal(body.data.username, TEST_USERNAME);
    });

    it('GET /api/v1/auth/me WITHOUT cookie → 401', async () => {
      const r = await app.request('/api/v1/auth/me');
      assert.equal(r.status, 401);
    });

    it('GET /api/v1/auth/me with tampered cookie → 401', async () => {
      const r = await app.request('/api/v1/auth/me', {
        headers: { cookie: 'he_auth=not-a-valid-jwt' },
      });
      assert.equal(r.status, 401);
    });
  });

  describe('PATCH /api/v1/auth/password', () => {
    beforeEach(async () => {
      await seedTestUser(db);
    });

    it('rejects without auth (401)', async () => {
      const r = await app.request('/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: 'new-strong-password',
        }),
      });
      assert.equal(r.status, 401);
    });

    it('rejects when current password is wrong (401)', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'wrong-current',
          newPassword: 'new-strong-password',
        }),
      });
      assert.equal(r.status, 401);
    });

    it('rejects short new password with 400', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: 'short',
        }),
      });
      assert.equal(r.status, 400);
    });

    it('updates the password — old fails, new succeeds at /login', async () => {
      const cookie = await testAuthCookie();
      const newPw = 'definitely-a-new-password';
      const patchRes = await app.request('/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: newPw,
        }),
      });
      assert.equal(patchRes.status, 204);

      // Old password no longer works.
      const oldLogin = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });
      assert.equal(oldLogin.status, 401);

      // New password works.
      const newLogin = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: newPw,
        }),
      });
      assert.equal(newLogin.status, 200);
    });
  });

  describe('end-to-end: signup → use → change-password → re-login', () => {
    it('completes the full account lifecycle', async () => {
      // 1. Sign up (fresh DB) → cookie set.
      const signup = await app.request('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'lifecycle',
          password: 'initial-password',
        }),
      });
      assert.equal(signup.status, 201);
      const cookie = (signup.headers.get('set-cookie') ?? '').split(';')[0];

      // 2. Use the cookie on a protected endpoint.
      const me = await app.request('/api/v1/auth/me', { headers: { cookie } });
      assert.equal(me.status, 200);

      // 3. Change password.
      const change = await app.request('/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'initial-password',
          newPassword: 'rotated-password',
        }),
      });
      assert.equal(change.status, 204);

      // 4. Login with the new password.
      const relogin = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'lifecycle',
          password: 'rotated-password',
        }),
      });
      assert.equal(relogin.status, 200);
    });
  });
});
