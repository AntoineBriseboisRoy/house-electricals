import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
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
import { TEST_AUTH, testAuthCookie } from './test-helpers.js';

const buildAuthedApp = (db: DatabaseSync): ReturnType<typeof buildApp> => {
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
    auth: TEST_AUTH,
  });
};

describe('auth gate (feat/auth-gate)', () => {
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

  describe('public routes (no auth required)', () => {
    it('GET /api/v1/health returns 200 without a cookie', async () => {
      const r = await app.request('/api/v1/health');
      assert.equal(r.status, 200);
    });

    it('POST /api/v1/auth/login accepts correct credentials + sets cookie', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_AUTH.username,
          password: TEST_AUTH.password,
        }),
      });
      assert.equal(r.status, 200);
      const setCookie = r.headers.get('set-cookie') ?? '';
      assert.ok(setCookie.includes('he_auth='), 'cookie should be set');
      assert.ok(
        setCookie.toLowerCase().includes('httponly'),
        'cookie must be HttpOnly'
      );
      assert.ok(
        setCookie.toLowerCase().includes('samesite=lax'),
        'cookie must be SameSite=Lax'
      );
    });

    it('POST /api/v1/auth/login rejects wrong password with 401', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_AUTH.username,
          password: 'wrong-password',
        }),
      });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get('set-cookie'), null);
    });

    it('POST /api/v1/auth/login rejects wrong username with 401', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'nobody',
          password: TEST_AUTH.password,
        }),
      });
      assert.equal(r.status, 401);
    });

    it('POST /api/v1/auth/login rejects malformed body with 400', async () => {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '' }),
      });
      assert.equal(r.status, 400);
    });

    it('POST /api/v1/auth/logout returns 204 and clears the cookie', async () => {
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
    it('GET /api/v1/panels without cookie → 401 JSON', async () => {
      const r = await app.request('/api/v1/panels');
      assert.equal(r.status, 401);
      const body = (await r.json()) as { error?: { message?: string } };
      assert.equal(typeof body.error?.message, 'string');
    });

    it('POST /api/v1/panels without cookie → 401 JSON', async () => {
      const r = await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });
      assert.equal(r.status, 401);
    });

    it('GET /api/v1/panels WITH valid cookie → 200', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/panels', {
        headers: { cookie },
      });
      assert.equal(r.status, 200);
    });

    it('GET /api/v1/auth/me WITH valid cookie returns username', async () => {
      const cookie = await testAuthCookie();
      const r = await app.request('/api/v1/auth/me', {
        headers: { cookie },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: { username: string } };
      assert.equal(body.data.username, TEST_AUTH.username);
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

  describe('end-to-end login → use → logout flow', () => {
    it('login then call protected with returned cookie then logout', async () => {
      // 1. Login → grab the cookie.
      const loginRes = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: TEST_AUTH.username,
          password: TEST_AUTH.password,
        }),
      });
      assert.equal(loginRes.status, 200);
      const setCookieHeader = loginRes.headers.get('set-cookie') ?? '';
      // Extract just the `he_auth=<token>` portion (drop attributes).
      const cookieValue = setCookieHeader.split(';')[0];
      assert.ok(cookieValue.startsWith('he_auth='));

      // 2. Use the cookie on a protected endpoint.
      const meRes = await app.request('/api/v1/auth/me', {
        headers: { cookie: cookieValue },
      });
      assert.equal(meRes.status, 200);

      // 3. Logout (clears cookie client-side; server's stateless JWT is
      //    still technically valid until expiry, but the browser drops
      //    it). Subsequent requests without re-sending the cookie 401.
      const logoutRes = await app.request('/api/v1/auth/logout', {
        method: 'POST',
      });
      assert.equal(logoutRes.status, 204);
      const noCookieRes = await app.request('/api/v1/auth/me');
      assert.equal(noCookieRes.status, 401);
    });
  });
});
