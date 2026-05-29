import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  componentInputSchema,
  componentPatchSchema,
  componentsListQuerySchema,
  type ApiEnvelope,
  type ApiError,
  type BreakerRepository,
  type Component,
  type ComponentRepository,
  type ResolvedComponent,
} from '@he/shared';

export const buildComponentRoutes = (
  repo: ComponentRepository,
  breakerRepo: BreakerRepository
): Hono => {
  const router = new Hono();

  const breakerExists = async (id: string): Promise<boolean> => {
    const b = await breakerRepo.get(id);
    return b !== null;
  };

  router.get(
    '/components',
    // Note: ?room= matches exactly and is case-sensitive (Postgres default collation).
    zValidator('query', componentsListQuerySchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid query.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const query = c.req.valid('query');
      const components = await repo.list({
        ...(query.room !== undefined ? { room: query.room } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.breakerId !== undefined ? { breakerId: query.breakerId } : {}),
        ...(query.floorId !== undefined ? { floorId: query.floorId } : {}),
        ...(query.search !== undefined ? { search: query.search } : {}),
        ...(query.buildingId !== undefined ? { buildingId: query.buildingId } : {}),
      });
      const body: ApiEnvelope<ResolvedComponent[]> = { data: components };
      return c.json(body, 200);
    }
  );

  router.post(
    '/components',
    zValidator('json', componentInputSchema, (result, c) => {
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
      if (input.breakerId != null && !(await breakerExists(input.breakerId))) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 400);
      }
      const component = await repo.create(input);
      const body: ApiEnvelope<Component> = { data: component };
      return c.json(body, 201);
    }
  );

  router.get('/components/:id', async (c) => {
    const id = c.req.param('id');
    const component = await repo.get(id);
    if (component === null) {
      const err: ApiError = { error: { message: 'Component not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<ResolvedComponent> = { data: component };
    return c.json(body, 200);
  });

  router.patch(
    '/components/:id',
    zValidator('json', componentPatchSchema, (result, c) => {
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
      if (patch.breakerId != null && !(await breakerExists(patch.breakerId))) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 400);
      }
      const updated = await repo.update(id, patch);
      if (updated === null) {
        const err: ApiError = { error: { message: 'Component not found.' } };
        return c.json(err, 404);
      }
      const body: ApiEnvelope<Component> = { data: updated };
      return c.json(body, 200);
    }
  );

  router.delete('/components/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await repo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Component not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
