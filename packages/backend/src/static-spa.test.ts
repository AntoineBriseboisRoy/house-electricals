import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { spaRoutes } from './routes/static-spa.js';

/**
 * Regression coverage for the SPA static-serving route.
 *
 * The load-bearing case is the blank-page-on-reload bug: a request for a
 * MISSING hashed asset (e.g. an old bundle a stale client still references)
 * MUST return 404, NOT a 200 text/html SPA fallback. Returning HTML under a
 * `.js` URL makes the browser execute HTML as JavaScript (blank page) and
 * lets the service-worker / HTTP cache poison itself so the blank persists
 * across reloads.
 */
describe('static-spa routes', () => {
  let root: string;
  let app: Hono;
  let prevPublicDir: string | undefined;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'he-spa-test-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><body><div id="root"></div>' +
        '<script src="/assets/index-ABC123.js"></script></body></html>'
    );
    writeFileSync(join(root, 'assets', 'index-ABC123.js'), 'console.log("real bundle");');
    writeFileSync(join(root, 'manifest.webmanifest'), '{"name":"House Electricals"}');
    writeFileSync(join(root, 'sw.js'), '/* service worker */');
    writeFileSync(join(root, 'registerSW.js'), '/* register */');
    writeFileSync(join(root, 'assets', 'workbox-9e0cfdd6.js'), '/* workbox runtime */');

    prevPublicDir = process.env.PUBLIC_DIR;
    process.env.PUBLIC_DIR = root;

    app = new Hono();
    app.route('/', spaRoutes);
  });

  after(() => {
    if (prevPublicDir === undefined) delete process.env.PUBLIC_DIR;
    else process.env.PUBLIC_DIR = prevPublicDir;
    rmSync(root, { recursive: true, force: true });
  });

  it('serves an existing hashed asset verbatim with JS mime + immutable cache', async () => {
    const res = await app.request('/assets/index-ABC123.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/javascript/);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);
    assert.equal(await res.text(), 'console.log("real bundle");');
  });

  it('returns 404 (NOT the SPA index.html) for a MISSING hashed asset', async () => {
    // This is the blank-page-on-reload regression: a stale client requesting
    // an old bundle hash must get a real 404, never 200 text/html.
    const res = await app.request('/assets/index-OLDHASH.js');
    assert.equal(res.status, 404);
    const ctype = res.headers.get('content-type') ?? '';
    assert.ok(
      !ctype.includes('text/html'),
      `missing .js must not be answered with HTML (got content-type: ${ctype})`
    );
  });

  it('returns 404 for any missing path that carries a file extension', async () => {
    for (const p of [
      '/assets/style-OLD.css',
      '/missing.png',
      '/favicon.ico',
      '/nope.woff2',
      '/config.json',
    ]) {
      const res = await app.request(p);
      assert.equal(res.status, 404, `${p} should 404`);
      assert.ok(
        !(res.headers.get('content-type') ?? '').includes('text/html'),
        `${p} must not be answered with HTML`
      );
    }
  });

  it('serves the SPA index.html for the root path', async () => {
    const res = await app.request('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(res.headers.get('cache-control') ?? '', /no-cache/);
    assert.match(await res.text(), /id="root"/);
  });

  it('falls back to SPA index.html for extension-less client routes', async () => {
    for (const p of ['/panels/01HXYZ', '/floors/abc/edit', '/library', '/test/audit']) {
      const res = await app.request(p);
      assert.equal(res.status, 200, `${p} should serve the SPA shell`);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/, `${p} should be HTML`);
      assert.match(await res.text(), /id="root"/, `${p} should be the SPA shell`);
    }
  });

  it('serves an existing manifest with the manifest mime', async () => {
    const res = await app.request('/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /manifest\+json/);
  });

  it('serves the service-worker entry scripts no-cache (so SW updates are not pinned)', async () => {
    for (const p of ['/sw.js', '/registerSW.js']) {
      const res = await app.request(p);
      assert.equal(res.status, 200, `${p} should serve`);
      assert.equal(
        res.headers.get('cache-control'),
        'no-cache',
        `${p} must be revalidated, not immutable`
      );
    }
  });

  it('keeps the hashed workbox runtime immutable (its URL changes with content)', async () => {
    const res = await app.request('/assets/workbox-9e0cfdd6.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);
  });

  it('returns JSON 404 for unknown /api/* paths (never HTML)', async () => {
    const res = await app.request('/api/v1/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await res.json(), { error: { message: 'Not found.' } });
  });

  it('returns 404 (no SPA) for unknown /files/* paths', async () => {
    const res = await app.request('/files/floor-plans/missing-1234abcd.png');
    assert.equal(res.status, 404);
    assert.ok(!(res.headers.get('content-type') ?? '').includes('text/html'));
  });
});
