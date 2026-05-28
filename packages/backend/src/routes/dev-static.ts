import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type { ApiError } from '@he/shared';

/**
 * Static-serve route for `/files/floor-plans/:filename`.
 *
 * After the single-image consolidation the Node backend is the front
 * door for every HTTP path: API at /api/v1/*, SPA at /*, AND these
 * floor-plan images at /files/floor-plans/*. There is no nginx in
 * front anymore — Hono is the only thing serving uploaded images.
 *
 * The file kept its historical `devStaticRoutes` name. Logic is the
 * same in dev and prod (path-traversal hardened, MIME-correct,
 * immutable cache header).
 *
 * Hardened against path traversal: filename is sanitized so it can't
 * contain a path separator or `..` segment, and the resolved final path
 * is verified to still live inside FLOOR_PLAN_DIR.
 */

const floorPlanDir = (): string => process.env.FLOOR_PLAN_DIR ?? '/data/floor-plans';

const mimeFor = (filename: string): string => {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
};

export const devStaticRoutes = new Hono();

devStaticRoutes.get('/files/floor-plans/:filename', (c) => {
  const filename = c.req.param('filename');
  // Reject anything that looks like a path traversal attempt.
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    filename.startsWith('.')
  ) {
    const err: ApiError = { error: { message: 'Invalid filename.' } };
    return c.json(err, 400);
  }
  const dir = resolve(floorPlanDir());
  const full = resolve(join(dir, filename));
  // Belt-and-suspenders: the resolved path must still live inside dir.
  if (!full.startsWith(dir + sep) && full !== dir) {
    const err: ApiError = { error: { message: 'Invalid filename.' } };
    return c.json(err, 400);
  }
  if (!existsSync(full)) {
    return c.body(null, 404);
  }
  const stat = statSync(full);
  if (!stat.isFile()) {
    return c.body(null, 404);
  }
  const bytes = readFileSync(full);
  return c.body(bytes, 200, {
    'content-type': mimeFor(filename),
    'cache-control': 'public, max-age=31536000, immutable',
    'content-length': String(stat.size),
  });
});
