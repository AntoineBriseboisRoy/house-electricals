import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  floorInputSchema,
  floorPatchSchema,
  moveToBuildingSchema,
  type ApiEnvelope,
  type ApiError,
  type Floor,
  type FloorRepository,
  type PanelRepository,
} from '@he/shared';
import { isUniqueConstraintError, uniqueNameTakenBody } from './unique-name.js';

/** True for a Postgres FK-violation error (SQLSTATE 23503 on `err.code`). */
const isForeignKeyError = (err: unknown): boolean =>
  err !== null &&
  typeof err === 'object' &&
  (err as { code?: string }).code === '23503';

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
    // 2026-05 — optional ?buildingId scopes to one building.
    const buildingId = c.req.query('buildingId');
    const floors = await repo.list(
      buildingId !== undefined && buildingId !== '' ? { buildingId } : undefined
    );
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

  // 2026-05 — move a floor (and the components placed on it) to another
  // building. Walls/rooms follow via floor_id; cross-building refs cleaned up.
  router.post(
    '/floors/:id/move',
    zValidator('json', moveToBuildingSchema, (result, c) => {
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
      const { buildingId } = c.req.valid('json');
      try {
        const moved = await repo.moveToBuilding(id, buildingId);
        if (moved === null) {
          const err: ApiError = { error: { message: 'Floor not found.' } };
          return c.json(err, 404);
        }
        const body: ApiEnvelope<Floor> = { data: moved };
        return c.json(body, 200);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          const e: ApiError = {
            error: {
              message: 'A floor with that name already exists in the target building.',
            },
          };
          return c.json(e, 409);
        }
        if (isForeignKeyError(err)) {
          const e: ApiError = { error: { message: 'Building not found.' } };
          return c.json(e, 400);
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
