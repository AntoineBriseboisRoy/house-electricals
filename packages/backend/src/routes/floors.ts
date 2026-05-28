import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  floorInputSchema,
  floorPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type Floor,
  type FloorRepository,
  type PanelRepository,
} from '@he/shared';
import { isUniqueConstraintError, uniqueNameTakenBody } from './unique-name.js';

export const buildFloorRoutes = (
  repo: FloorRepository,
  panelRepo: PanelRepository
): Hono => {
  const router = new Hono();

  /**
   * Cycle-85 — validate `panelId` on POST/PATCH bodies. When the caller
   * passes a non-null panel id, ensure the panel actually exists (404 if
   * not, surfaced through the standard error envelope). null is always
   * accepted (it clears the link).
   *
   * Returns `null` on success (proceed) or a Response on validation
   * failure (the caller should `return` it).
   */
  const validatePanelId = async (
    panelId: string | null | undefined
  ): Promise<{ status: 404; body: ApiError } | null> => {
    if (panelId === undefined || panelId === null) return null;
    const panel = await panelRepo.get(panelId);
    if (panel === null) {
      return { status: 404, body: { error: { message: 'Panel not found.' } } };
    }
    return null;
  };

  router.get('/floors', async (c) => {
    const floors = await repo.list();
    const body: ApiEnvelope<Floor[]> = { data: floors };
    return c.json(body, 200);
  });

  router.post(
    '/floors',
    zValidator('json', floorInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const input = c.req.valid('json');
      // Cycle-85 — validate the linked panel exists before INSERT.
      const panelErr = await validatePanelId(input.panelId ?? null);
      if (panelErr !== null) return c.json(panelErr.body, panelErr.status);
      try {
        const floor = await repo.create(input);
        const body: ApiEnvelope<Floor> = { data: floor };
        return c.json(body, 201);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(uniqueNameTakenBody(input.name), 409);
        }
        throw err;
      }
    }
  );

  router.get('/floors/:id', async (c) => {
    const id = c.req.param('id');
    const floor = await repo.get(id);
    if (floor === null) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Floor> = { data: floor };
    return c.json(body, 200);
  });

  router.patch(
    '/floors/:id',
    zValidator('json', floorPatchSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const id = c.req.param('id');
      const patch = c.req.valid('json');
      // Cycle-85 — validate the linked panel exists before UPDATE. null
      // and undefined both short-circuit (validatePanelId handles that).
      const panelErr = await validatePanelId(patch.panelId);
      if (panelErr !== null) return c.json(panelErr.body, panelErr.status);
      try {
        const updated = await repo.update(id, patch);
        if (updated === null) {
          const err: ApiError = { error: { message: 'Floor not found.' } };
          return c.json(err, 404);
        }
        const body: ApiEnvelope<Floor> = { data: updated };
        return c.json(body, 200);
      } catch (err) {
        if (isUniqueConstraintError(err) && patch.name !== undefined) {
          return c.json(uniqueNameTakenBody(patch.name), 409);
        }
        throw err;
      }
    }
  );

  router.delete('/floors/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await repo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
