import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  wallInputSchema,
  wallPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type FloorRepository,
  type Wall,
  type WallRepository,
} from '@he/shared';

/**
 * Walls routes (G12).
 *
 * - GET  /api/v1/floors/:floorId/walls  — list this floor's walls
 * - POST /api/v1/floors/:floorId/walls  — create a wall on this floor
 * - GET  /api/v1/walls/:id              — fetch a single wall
 * - PATCH /api/v1/walls/:id             — partial coord update (no floor_id move)
 * - DELETE /api/v1/walls/:id            — delete
 *
 * Floor cascade: DELETE on `/api/v1/floors/:id` walks `ON DELETE CASCADE`
 * at the FK level so walls die with their floor.
 */
export const buildWallRoutes = (
  wallRepo: WallRepository,
  floorRepo: FloorRepository
): Hono => {
  const router = new Hono();

  router.get('/floors/:floorId/walls', async (c) => {
    const floorId = c.req.param('floorId');
    const floor = await floorRepo.get(floorId);
    if (floor === null) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }
    const walls = await wallRepo.listByFloor(floorId);
    const body: ApiEnvelope<Wall[]> = { data: walls };
    return c.json(body, 200);
  });

  router.post(
    '/floors/:floorId/walls',
    zValidator('json', wallInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const floorId = c.req.param('floorId');
      const floor = await floorRepo.get(floorId);
      if (floor === null) {
        const err: ApiError = { error: { message: 'Floor not found.' } };
        return c.json(err, 404);
      }
      const input = c.req.valid('json');
      const wall = await wallRepo.create(floorId, input);
      const body: ApiEnvelope<Wall> = { data: wall };
      return c.json(body, 201);
    }
  );

  router.get('/walls/:id', async (c) => {
    const id = c.req.param('id');
    const wall = await wallRepo.get(id);
    if (wall === null) {
      const err: ApiError = { error: { message: 'Wall not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Wall> = { data: wall };
    return c.json(body, 200);
  });

  router.patch(
    '/walls/:id',
    zValidator('json', wallPatchSchema, (result, c) => {
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
      const updated = await wallRepo.update(id, patch);
      if (updated === null) {
        const err: ApiError = { error: { message: 'Wall not found.' } };
        return c.json(err, 404);
      }
      const body: ApiEnvelope<Wall> = { data: updated };
      return c.json(body, 200);
    }
  );

  router.delete('/walls/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await wallRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Wall not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
