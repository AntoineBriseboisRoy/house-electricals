import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import {
  newId,
  type ApiEnvelope,
  type ApiError,
  type Attachment,
  type AttachmentRepository,
  type BreakerRepository,
  type ComponentRepository,
} from '@he/shared';
import { sniffImage } from '../image-meta.js';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same cap as floor-plan uploads.

// Photos are stored alongside floor-plan images under FLOOR_PLAN_DIR and
// served by the SAME static route (/files/floor-plans/:filename). Filenames
// are globally unique (ULID + content hash) so there is no collision with
// floor-plan files or between photos. The DB stores filename only — never a
// URL (same contract as floor plans; keeps deployment topology out of the DB).
const photoDir = (): string => process.env.FLOOR_PLAN_DIR ?? '/data/floor-plans';

/**
 * Photo (attachment) routes — 2026-05.
 *
 *  - POST   /api/v1/components/:id/photos   (multipart, field "file") → 201 Attachment
 *  - GET    /api/v1/components/:id/photos    → Attachment[]
 *  - POST   /api/v1/breakers/:id/photos      (multipart) → 201 Attachment
 *  - GET    /api/v1/breakers/:id/photos      → Attachment[]
 *  - DELETE /api/v1/photos/:id               → 204 (unlinks the file too)
 *
 * Reuses the floor-plan image pipeline: magic-byte sniff (PNG/JPEG/WebP,
 * SVG rejected), 10MB cap, hashed filename, served via /files/floor-plans/.
 */
export const buildAttachmentRoutes = (
  componentRepo: ComponentRepository,
  breakerRepo: BreakerRepository,
  attachmentRepo: AttachmentRepository
): Hono => {
  const router = new Hono();
  mkdirSync(photoDir(), { recursive: true });

  const handleUpload = async (
    c: Context,
    parentType: 'component' | 'breaker',
    parentId: string
  ): Promise<Response> => {
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
    // ULID prefix guarantees uniqueness even for the same image on two parents.
    const filename = `photo-${newId()}-${hash}.${meta.ext}`;
    const outPath = join(photoDir(), filename);
    writeFileSync(outPath, buf);

    let created: Attachment;
    try {
      created = await attachmentRepo.create({ parentType, parentId, filename });
    } catch (e) {
      // Roll the file back if the DB insert fails so we don't leak it.
      try {
        unlinkSync(outPath);
      } catch {
        // best-effort
      }
      throw e;
    }
    const body: ApiEnvelope<Attachment> = { data: created };
    return c.json(body, 201);
  };

  router.post('/components/:id/photos', async (c) => {
    const id = c.req.param('id');
    const parent = await componentRepo.get(id);
    if (parent === null) {
      const err: ApiError = { error: { message: 'Component not found.' } };
      return c.json(err, 404);
    }
    return handleUpload(c, 'component', id);
  });

  router.get('/components/:id/photos', async (c) => {
    const id = c.req.param('id');
    const list = await attachmentRepo.listByParent('component', id);
    const body: ApiEnvelope<Attachment[]> = { data: list };
    return c.json(body, 200);
  });

  router.post('/breakers/:id/photos', async (c) => {
    const id = c.req.param('id');
    const parent = await breakerRepo.get(id);
    if (parent === null) {
      const err: ApiError = { error: { message: 'Breaker not found.' } };
      return c.json(err, 404);
    }
    return handleUpload(c, 'breaker', id);
  });

  router.get('/breakers/:id/photos', async (c) => {
    const id = c.req.param('id');
    const list = await attachmentRepo.listByParent('breaker', id);
    const body: ApiEnvelope<Attachment[]> = { data: list };
    return c.json(body, 200);
  });

  router.delete('/photos/:id', async (c) => {
    const id = c.req.param('id');
    const att = await attachmentRepo.get(id);
    if (att === null) {
      const err: ApiError = { error: { message: 'Photo not found.' } };
      return c.json(err, 404);
    }
    const removed = await attachmentRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Photo not found.' } };
      return c.json(err, 404);
    }
    // Best-effort file unlink — the row is the source of truth; a missing
    // file just means it was already gone.
    try {
      unlinkSync(join(photoDir(), att.filename));
    } catch {
      // best-effort
    }
    return c.body(null, 204);
  });

  return router;
};
