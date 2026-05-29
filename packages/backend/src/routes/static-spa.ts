import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type { ApiError } from '@he/shared';

/**
 * Static SPA + asset serving.
 *
 * Serves the Vite-built frontend bundle from PUBLIC_DIR (default
 * `/app/public` inside the runtime image). Mounted LAST in the route
 * table so /api/v1/* and /files/floor-plans/* match first.
 *
 * Behaviour:
 *   - GET /<existing-file-inside-PUBLIC_DIR>   → serve verbatim with MIME +
 *                                                cache headers (immutable for
 *                                                hashed Vite assets, no-cache
 *                                                for HTML / manifest / SW).
 *   - GET /<missing-path-with-extension>       → 404 (a missing static asset,
 *                                                e.g. an old hashed bundle a
 *                                                stale client still references;
 *                                                MUST NOT fall back to HTML —
 *                                                see the long comment below).
 *   - GET /<extension-less-route>              → SPA fallback to index.html
 *                                                so wouter handles client-side
 *                                                routing.
 *   - GET /api/<unknown>                       → JSON 404 (don't poison JSON
 *                                                consumers with HTML).
 *   - GET /files/<unknown>                     → 404 (uploaded images that
 *                                                aren't on disk don't fall
 *                                                back to SPA).
 *
 * In local dev (PUBLIC_DIR missing or empty) this handler silently 404s
 * everything — the dev workflow uses Vite on its own port for the SPA.
 *
 * Path-traversal hardening mirrors the cycle-9 floor-plan upload route:
 * `..` segments are rejected and the resolved path must still live
 * under PUBLIC_DIR.
 */

const ASSET_EXTS = new Set([
  '.js', '.mjs', '.css',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.map',
]);
const NOCACHE_EXTS = new Set(['.html', '.webmanifest', '.json', '.txt']);

// The service-worker entry scripts have STABLE URLs across builds
// (/sw.js, /registerSW.js) — unlike content-hashed Vite assets. Serving
// them `immutable` would let a stale copy linger in the HTTP cache and
// delay service-worker updates — the very mechanism that heals a client
// stuck on an old shell after a deploy. Force revalidation instead. The
// hashed workbox-<hash>.js runtime keeps the immutable treatment (its URL
// changes when its content does).
const NOCACHE_BASENAMES = new Set(['sw.js', 'registerSW.js']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const mimeFor = (path: string): string =>
  MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

const cacheFor = (path: string): string => {
  if (NOCACHE_BASENAMES.has(basename(path))) return 'no-cache';
  const ext = extname(path).toLowerCase();
  if (ASSET_EXTS.has(ext)) return 'public, max-age=31536000, immutable';
  if (NOCACHE_EXTS.has(ext)) return 'no-cache';
  return 'public, max-age=3600';
};

const publicDirFromEnv = (): string =>
  process.env.PUBLIC_DIR ?? '/app/public';

const tryServe = (
  root: string,
  relPath: string
):
  | { bytes: Uint8Array; full: string; size: number }
  | null => {
  if (relPath.includes('..')) return null;
  const full = resolve(join(root, relPath));
  if (!full.startsWith(root + sep) && full !== root) return null;
  if (!existsSync(full)) return null;
  const stat = statSync(full);
  if (!stat.isFile()) return null;
  const buf = readFileSync(full);
  // Hono's c.body() types reject Node Buffer (SharedArrayBuffer backing
  // mismatch); rewrap as a plain Uint8Array.
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return { bytes, full, size: stat.size };
};

export const spaRoutes = new Hono();

spaRoutes.get('/*', (c) => {
  const path = new URL(c.req.url).pathname;

  // /api/* misses MUST return JSON 404 (not the SPA index.html — JSON
  // consumers would explode trying to parse it).
  if (path.startsWith('/api/')) {
    const err: ApiError = { error: { message: 'Not found.' } };
    return c.json(err, 404);
  }
  // /files/* misses — those are user-uploaded images. 404 directly; no SPA.
  if (path.startsWith('/files/')) {
    return c.body(null, 404);
  }

  const root = resolve(publicDirFromEnv());
  const target = path === '/' || path === '' ? '/index.html' : path;

  // Try the literal file first (hashed Vite assets, /favicon.ico, etc.).
  // Bypass Hono's c.body() wrapper — its overloads reject Uint8Array
  // with the strict TS 5.7 ArrayBufferLike narrowing. Response()
  // constructor accepts BodyInit unconditionally.
  const direct = tryServe(root, target);
  if (direct !== null) {
    return new Response(direct.bytes, {
      status: 200,
      headers: {
        'content-type': mimeFor(direct.full),
        'cache-control': cacheFor(direct.full),
        'content-length': String(direct.size),
      },
    });
  }

  // A request that carries a file extension is a STATIC-ASSET request
  // (e.g. /assets/index-<hash>.js, /favicon.ico, /manifest.webmanifest).
  // If it didn't resolve to a real file above, it is genuinely missing —
  // return a real 404. Serving the SPA index.html here (200 text/html)
  // is a TRAP that produces a persistent blank page:
  //   1. A stale client (old cached HTML or an old service-worker shell)
  //      requests an old hashed bundle, e.g. /assets/index-OLDHASH.js,
  //      which the current build no longer contains.
  //   2. The greedy SPA fallback answers 200 + the index.html body.
  //   3. The browser tries to execute that HTML as JavaScript
  //      ("Uncaught SyntaxError: Unexpected token '<'"), so React never
  //      mounts → blank #root.
  //   4. Because the status is 200 (not 404), the service worker / HTTP
  //      cache happily stores the HTML under the .js URL, poisoning the
  //      cache so the blank page survives every reload.
  // Only extension-less paths are treated as client-side navigation
  // routes eligible for the SPA fallback below. (App routes are
  // extension-less: /panels/:id, /floors/:id/edit, etc.)
  if (extname(path) !== '') {
    return c.body(null, 404);
  }

  // SPA fallback: extension-less navigation route → index.html so wouter
  // takes over client-side routing.
  const index = tryServe(root, '/index.html');
  if (index !== null) {
    return new Response(index.bytes, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-length': String(index.size),
      },
    });
  }

  // No PUBLIC_DIR / no index.html — local dev with no built frontend.
  // Devs run Vite on its own port for the SPA in this mode.
  return c.body(null, 404);
});
