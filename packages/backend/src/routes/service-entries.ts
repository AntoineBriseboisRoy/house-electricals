import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  serviceEntryInputSchema,
  serviceEntryListQuerySchema,
  type ApiEnvelope,
  type ApiError,
  type BreakerRepository,
  type ComponentRepository,
  type ServiceEntry,
  type ServiceEntryRepository,
} from '@he/shared';

/**
 * G40 Part 1 (cycle-66) — server-side default LIMIT for the service-log
 * list. Matches the cycle-63 DEFAULT_AUDIT_LIMIT.
 *
 * Capping at 200 keeps the payload bounded even on long histories. The
 * response carries `totalCount` so the UI can show "Showing N of M" hints.
 * Callers that need a different page size pass `?limit=N` (zod schema
 * bounds it to 1000).
 */
const DEFAULT_SERVICE_LIMIT = 200;

/**
 * Service-log entry routes (G40 Part 1 cycle-66).
 *
 *  - POST   /api/v1/breakers/:breakerId/service-entries
 *      body: { note, occurredAt? } → 201 with ServiceEntry
 *  - POST   /api/v1/components/:componentId/service-entries
 *      body: { note, occurredAt? } → 201 with ServiceEntry
 *  - GET    /api/v1/service-entries?parentType=&parentId=&parentIds=&since=&until=&limit=
 *      → { data: ServiceEntry[], totalCount: number } sorted occurred_at DESC,
 *        id DESC; LIMIT defaults to 200 server-side.
 *  - DELETE /api/v1/service-entries/:id → 204
 *
 * Polymorphism is URL-driven (NOT body-driven) — parent_type comes from
 * the route path. parent_type is closed app-level state with a CHECK
 * constraint (cycle-66 ADR). See CLAUDE.md "Service-log entries (G40
 * Part 1 — cycle-66)". Service-log GETs are NOT in the SWR allowlist —
 * they fall through to NetworkFirst (durable user records must be fresh
 * on read).
 */
export const buildServiceEntryRoutes = (
  breakerRepo: BreakerRepository,
  componentRepo: ComponentRepository,
  serviceEntryRepo: ServiceEntryRepository
): Hono => {
  const router = new Hono();

  router.post(
    '/breakers/:breakerId/service-entries',
    zValidator('json', serviceEntryInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const breakerId = c.req.param('breakerId');
      const breaker = await breakerRepo.get(breakerId);
      if (breaker === null) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 404);
      }
      const input = c.req.valid('json');
      const entry = await serviceEntryRepo.create({
        parentType: 'breaker',
        parentId: breakerId,
        occurredAt: input.occurredAt,
        note: input.note,
      });
      const body: ApiEnvelope<ServiceEntry> = { data: entry };
      return c.json(body, 201);
    }
  );

  router.post(
    '/components/:componentId/service-entries',
    zValidator('json', serviceEntryInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const componentId = c.req.param('componentId');
      const component = await componentRepo.get(componentId);
      if (component === null) {
        const err: ApiError = { error: { message: 'Component not found.' } };
        return c.json(err, 404);
      }
      const input = c.req.valid('json');
      const entry = await serviceEntryRepo.create({
        parentType: 'component',
        parentId: componentId,
        occurredAt: input.occurredAt,
        note: input.note,
      });
      const body: ApiEnvelope<ServiceEntry> = { data: entry };
      return c.json(body, 201);
    }
  );

  router.get(
    '/service-entries',
    zValidator('query', serviceEntryListQuerySchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid query.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const q = c.req.valid('query');
      // Server-side default LIMIT 200 (matches cycle-63 audit pattern).
      // Clamp upper bound to DEFAULT_SERVICE_LIMIT regardless of zod's
      // accepted ceiling (1000) so payload size is always bounded.
      const requestedLimit = q.limit ?? DEFAULT_SERVICE_LIMIT;
      const limit = Math.min(requestedLimit, DEFAULT_SERVICE_LIMIT);
      // Parse comma-separated parentIds (bulk fetch — used by
      // PanelDetailScreen to load entries for every breaker on the panel
      // in one round-trip).
      const parentIds =
        q.parentIds !== undefined
          ? q.parentIds
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : undefined;
      const result = await serviceEntryRepo.list({
        parentType: q.parentType,
        parentId: q.parentId,
        parentIds,
        since: q.since,
        until: q.until,
        limit,
      });
      const body: ApiEnvelope<ServiceEntry[]> & { totalCount: number } = {
        data: result.data,
        totalCount: result.totalCount,
      };
      return c.json(body, 200);
    }
  );

  router.delete('/service-entries/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await serviceEntryRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Service entry not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
