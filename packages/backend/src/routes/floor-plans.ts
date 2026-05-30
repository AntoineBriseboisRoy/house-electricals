import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ApiEnvelope, ApiError, Floor, FloorRepository } from '@he/shared';
import { sniffImage } from '../image-meta.js';
import { assertInsideDir } from '../safe-path.js';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// Hard request-body ceiling enforced BEFORE the body is buffered into memory
// (G46 FIX 1). Set just above MAX_BYTES so the friendly 413 below still fires
// for a 10–11 MB upload, while anything larger is rejected by the middleware
// before `parseBody` can OOM the process.
const MAX_REQUEST_BYTES = 11 * 1024 * 1024; // 11 MB

const floorPlanDir = (): string => process.env.FLOOR_PLAN_DIR ?? '/data/floor-plans';

/**
 * Floor-plan upload + delete routes (G13).
 *
 * Pre-G13 these were per-panel (`/api/v1/panels/:id/floor-plan`). With
 * floors as first-class entities, upload/replace/delete is now scoped to
 * a floor. Filename convention unchanged: `<floorId>-<sha8>.<ext>`,
 * stored under FLOOR_PLAN_DIR. The hash-in-filename is still load-bearing
 * (self-cache-busting on re-upload).
 */
export const buildFloorPlanRoutes = (floorRepo: FloorRepository): Hono => {
  const router = new Hono();
  mkdirSync(floorPlanDir(), { recursive: true });

  router.post(
    '/floors/:floorId/floor-plan',
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => {
        const err: ApiError = { error: { message: 'File too large (max 10 MB).' } };
        return c.json(err, 413);
      },
    }),
    async (c) => {
    const id = c.req.param('floorId');
    const floor = await floorRepo.get(id);
    if (floor === null) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }

    let form: Awaited<ReturnType<typeof c.req.parseBody>>;
    try {
      form = await c.req.parseBody({ all: false });
    } catch {
      const err: ApiError = { error: { message: 'Multipart body required.' } };
      return c.json(err, 400);
    }
    const file = form.file;
    if (!(file instanceof File)) {
      const err: ApiError = {
        error: { message: 'Field "file" is required and must be an image file.' },
      };
      return c.json(err, 400);
    }
    if (file.size > MAX_BYTES) {
      const err: ApiError = { error: { message: 'Image is too large (max 10MB).' } };
      return c.json(err, 400);
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const meta = sniffImage(buf);
    if (meta === null) {
      const err: ApiError = {
        error: { message: 'Unsupported or invalid image. PNG, JPEG, or WebP only.' },
      };
      return c.json(err, 400);
    }

    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    const filename = `${floor.id}-${hash}.${meta.ext}`;
    const outPath = join(floorPlanDir(), filename);
    writeFileSync(outPath, buf);

    const previous = floor.floorPlan?.filename ?? null;

    const updated = await floorRepo.setFloorPlan(floor.id, {
      filename,
      width: meta.width,
      height: meta.height,
    });
    if (updated === null) {
      try {
        unlinkSync(outPath);
      } catch {
        // best-effort
      }
      const err: ApiError = { error: { message: 'Floor disappeared during upload.' } };
      return c.json(err, 404);
    }

    if (previous !== null && previous !== filename) {
      // `previous` is a DB-stored filename; resolve-inside-dir guard before
      // unlinking (G46 FIX 4 — defense-in-depth).
      const prevPath = assertInsideDir(floorPlanDir(), previous);
      if (prevPath !== null) {
        try {
          unlinkSync(prevPath);
        } catch {
          // best-effort: old file may already be gone
        }
      }
    }

    const body: ApiEnvelope<Floor> = { data: updated };
    return c.json(body, 200);
  }
  );

  router.delete('/floors/:floorId/floor-plan', async (c) => {
    const id = c.req.param('floorId');
    const floor = await floorRepo.get(id);
    if (floor === null || floor.floorPlan === null) {
      const err: ApiError = { error: { message: 'No floor plan to remove.' } };
      return c.json(err, 404);
    }
    const previous = floor.floorPlan.filename;
    const updated = await floorRepo.clearFloorPlan(floor.id);
    if (updated === null) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }
    // `previous` is a DB-stored filename; guard before unlinking (G46 FIX 4).
    const prevPath = assertInsideDir(floorPlanDir(), previous);
    if (prevPath !== null) {
      try {
        unlinkSync(prevPath);
      } catch {
        // best-effort
      }
    }
    const body: ApiEnvelope<Floor> = { data: updated };
    return c.json(body, 200);
  });

  return router;
};
