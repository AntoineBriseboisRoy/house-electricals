import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  breakerStateEventListQuerySchema,
  breakerStateToggleSchema,
  type ApiEnvelope,
  type ApiError,
  type Breaker,
  type BreakerRepository,
  type BreakerStateEvent,
  type BreakerStateEventRepository,
} from '@he/shared';

/**
 * Default LIMIT for the breaker on/off audit list. Mirrors the breaker-tests
 * audit cap (cycle-63) so payloads stay bounded; the response carries
 * `totalCount` for "Showing N of M" hints.
 */
const DEFAULT_STATE_AUDIT_LIMIT = 200;

/**
 * Breaker on/off state routes (2026-05).
 *
 *  - POST /api/v1/breakers/:breakerId/state
 *      body: { isOn: boolean, note? } → 200 with the updated Breaker.
 *      Persists `breakers.is_on` AND writes a breaker_state_events audit row
 *      (scoped to the breaker AND its panel). Idempotent: toggling to the
 *      state it's already in still records an event (the user "confirmed" it).
 *  - GET /api/v1/breaker-state-events?breakerId=&panelId=&since=&until=&limit=
 *      → { data: BreakerStateEvent[], totalCount } sorted occurred_at DESC.
 *
 * Distinct from breaker_tests (verification). State changes go through this
 * dedicated audited endpoint, NOT the generic breaker PATCH — that keeps
 * relabeling/amperage edits from spamming the on/off audit. Audit GETs are
 * NetworkFirst (fresh on read), NOT in the SWR allowlist.
 */
export const buildBreakerStateRoutes = (
  breakerRepo: BreakerRepository,
  stateEventRepo: BreakerStateEventRepository
): Hono => {
  const router = new Hono();

  router.post(
    '/breakers/:breakerId/state',
    zValidator('json', breakerStateToggleSchema, (result, c) => {
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
      const existing = await breakerRepo.get(breakerId);
      if (existing === null) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 404);
      }
      const { isOn, note } = c.req.valid('json');

      const updated = await breakerRepo.setState(breakerId, isOn);
      if (updated === null) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 404);
      }
      // Audit the action — scoped to the breaker AND its panel.
      await stateEventRepo.create({
        breakerId,
        panelId: existing.panelId,
        isOn,
        note: note ?? null,
      });

      const body: ApiEnvelope<Breaker> = { data: updated };
      return c.json(body, 200);
    }
  );

  router.get(
    '/breaker-state-events',
    zValidator('query', breakerStateEventListQuerySchema, (result, c) => {
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
      const requestedLimit = q.limit ?? DEFAULT_STATE_AUDIT_LIMIT;
      const limit = Math.min(requestedLimit, DEFAULT_STATE_AUDIT_LIMIT);
      const result = await stateEventRepo.list({
        breakerId: q.breakerId,
        panelId: q.panelId,
        since: q.since,
        until: q.until,
        limit,
      });
      const body: ApiEnvelope<BreakerStateEvent[]> & { totalCount: number } = {
        data: result.data,
        totalCount: result.totalCount,
      };
      return c.json(body, 200);
    }
  );

  return router;
};
