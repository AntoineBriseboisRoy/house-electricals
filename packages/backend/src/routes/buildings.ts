import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  buildingInputSchema,
  buildingPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type Building,
  type BuildingRepository,
} from '@he/shared';
import { isUniqueConstraintError, uniqueNameTakenBody } from './unique-name.js';

/**
 * Buildings (2026-05) — the top-level entity owning panels/floors/components.
 * Standard flat REST, mirroring the floors/panels route shape. Names are
 * unique (one namespace of buildings per deployment) → 409 on collision.
 */
export const buildBuildingRoutes = (repo: BuildingRepository): Hono => {
  const router = new Hono();

  router.get('/buildings', async (c) => {
    const buildings = await repo.list();
    const body: ApiEnvelope<Building[]> = { data: buildings };
    return c.json(body, 200);
  });

  router.post(
    '/buildings',
    zValidator('json', buildingInputSchema, (result, c) => {
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
      try {
        const building = await repo.create(input);
        const body: ApiEnvelope<Building> = { data: building };
        return c.json(body, 201);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(uniqueNameTakenBody(input.name), 409);
        }
        throw err;
      }
    }
  );

  router.get('/buildings/:id', async (c) => {
    const id = c.req.param('id');
    const building = await repo.get(id);
    if (building === null) {
      const err: ApiError = { error: { message: 'Building not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Building> = { data: building };
    return c.json(body, 200);
  });

  router.patch(
    '/buildings/:id',
    zValidator('json', buildingPatchSchema, (result, c) => {
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
        const updated = await repo.update(id, patch);
        if (updated === null) {
          const err: ApiError = { error: { message: 'Building not found.' } };
          return c.json(err, 404);
        }
        const body: ApiEnvelope<Building> = { data: updated };
        return c.json(body, 200);
      } catch (err) {
        if (isUniqueConstraintError(err) && patch.name !== undefined) {
          return c.json(uniqueNameTakenBody(patch.name), 409);
        }
        throw err;
      }
    }
  );

  router.delete('/buildings/:id', async (c) => {
    const id = c.req.param('id');
    // Guard: never delete the last building — the app always needs at least
    // one (every panel/floor/component must have a home, and a fresh-empty
    // state would otherwise wedge the create flow until the next boot reseed).
    const all = await repo.list();
    if (all.length <= 1) {
      const err: ApiError = {
        error: { message: "You can't delete your only building." },
      };
      return c.json(err, 409);
    }
    const removed = await repo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Building not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
