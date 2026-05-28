import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  roomInputSchema,
  roomPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type FloorRepository,
  type Room,
  type RoomRepository,
} from '@he/shared';
import { isUniqueConstraintError, uniqueNameTakenBody } from './unique-name.js';

/**
 * Rooms routes (G12).
 *
 * Mirrors walls — nested for create/list (room exists per floor), flat for
 * item operations. PATCH never accepts floor_id; rooms don't migrate
 * between floors. Floor cascade: DELETE on /api/v1/floors/:id cascades to
 * delete its rooms via the FK's ON DELETE CASCADE.
 */
export const buildRoomRoutes = (
  roomRepo: RoomRepository,
  floorRepo: FloorRepository
): Hono => {
  const router = new Hono();

  // Cycle-85 — flat house-level list. Used by ComponentForm to power the
  // Room datalist autocomplete (so previously-named rooms suggest even
  // when the user is filtering by a different room). Mirrors the cycle-1
  // "collections that span parents are flat" URL rule.
  router.get('/rooms', async (c) => {
    const rooms = await roomRepo.listAll();
    const body: ApiEnvelope<Room[]> = { data: rooms };
    return c.json(body, 200);
  });

  router.get('/floors/:floorId/rooms', async (c) => {
    const floorId = c.req.param('floorId');
    const floor = await floorRepo.get(floorId);
    if (floor === null) {
      const err: ApiError = { error: { message: 'Floor not found.' } };
      return c.json(err, 404);
    }
    const rooms = await roomRepo.listByFloor(floorId);
    const body: ApiEnvelope<Room[]> = { data: rooms };
    return c.json(body, 200);
  });

  router.post(
    '/floors/:floorId/rooms',
    zValidator('json', roomInputSchema, (result, c) => {
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
      try {
        const room = await roomRepo.create(floorId, input);
        const body: ApiEnvelope<Room> = { data: room };
        return c.json(body, 201);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(uniqueNameTakenBody(input.name), 409);
        }
        throw err;
      }
    }
  );

  router.get('/rooms/:id', async (c) => {
    const id = c.req.param('id');
    const room = await roomRepo.get(id);
    if (room === null) {
      const err: ApiError = { error: { message: 'Room not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Room> = { data: room };
    return c.json(body, 200);
  });

  router.patch(
    '/rooms/:id',
    zValidator('json', roomPatchSchema, (result, c) => {
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
      try {
        const updated = await roomRepo.update(id, patch);
        if (updated === null) {
          const err: ApiError = { error: { message: 'Room not found.' } };
          return c.json(err, 404);
        }
        const body: ApiEnvelope<Room> = { data: updated };
        return c.json(body, 200);
      } catch (err) {
        if (isUniqueConstraintError(err) && patch.name !== undefined) {
          return c.json(uniqueNameTakenBody(patch.name), 409);
        }
        throw err;
      }
    }
  );

  router.delete('/rooms/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await roomRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Room not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
