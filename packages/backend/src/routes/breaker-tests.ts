import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  breakerTestInputSchema,
  breakerTestListQuerySchema,
  type ApiEnvelope,
  type ApiError,
  type BreakerRepository,
  type BreakerTest,
  type BreakerTestRepository,
} from '@he/shared';

/**
 * G36 Part 2 (cycle-63) — server-side default LIMIT for the audit list.
 *
 * The /audit screen renders most-recent-first; capping at 200 keeps the
 * payload bounded even on long histories. The response carries
 * `totalCount` so the UI can show "Showing most-recent 200 of N" hints.
 * Callers that need a different page size pass `?limit=N` (zod schema
 * bounds it to 1000).
 */
const DEFAULT_AUDIT_LIMIT = 200;

/**
 * Breaker-test audit trail routes (G36 cycle-61, extended cycle-63).
 *
 *  - POST   /api/v1/breakers/:breakerId/breaker-tests
 *      body: { testedAt?, outcome?, notes? } → 201 with BreakerTest
 *  - GET    /api/v1/breaker-tests?breakerId=&since=&until=&outcome=&limit=
 *      → { data: BreakerTest[], totalCount: number } sorted tested_at DESC,
 *        id DESC; LIMIT defaults to 200 server-side.
 *  - DELETE /api/v1/breaker-tests/:id → 204
 *
 * `outcome` is FREE TEXT (no CHECK enum) per CLAUDE.md "Breaker-test audit
 * trail (G36 — cycle-61)". Audit GETs are NOT in the SWR allowlist — they
 * fall through to NetworkFirst (audit data must be fresh on read).
 */
export const buildBreakerTestRoutes = (
  breakerRepo: BreakerRepository,
  breakerTestRepo: BreakerTestRepository
): Hono => {
  const router = new Hono();

  router.post(
    '/breakers/:breakerId/breaker-tests',
    zValidator('json', breakerTestInputSchema, (result, c) => {
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
      const test = await breakerTestRepo.create({
        breakerId,
        testedAt: input.testedAt,
        outcome: input.outcome ?? null,
        notes: input.notes ?? null,
      });
      const body: ApiEnvelope<BreakerTest> = { data: test };
      return c.json(body, 201);
    }
  );

  router.get(
    '/breaker-tests',
    zValidator('query', breakerTestListQuerySchema, (result, c) => {
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
      // G36 Part 2 (cycle-63) — server-side default LIMIT 200. Callers can
      // explicitly request a smaller page; we clamp the upper bound to
      // DEFAULT_AUDIT_LIMIT regardless of what zod accepts (1000) so the
      // payload size is always bounded for /audit consumers.
      const requestedLimit = q.limit ?? DEFAULT_AUDIT_LIMIT;
      const limit = Math.min(requestedLimit, DEFAULT_AUDIT_LIMIT);
      const result = await breakerTestRepo.list({
        breakerId: q.breakerId,
        since: q.since,
        until: q.until,
        outcome: q.outcome,
        limit,
      });
      // Wider response shape — { data, totalCount } — so the /audit screen
      // can show "Showing N of M" when totalCount > limit. Consumers that
      // only need the array still read body.data.
      const body: ApiEnvelope<BreakerTest[]> & { totalCount: number } = {
        data: result.data,
        totalCount: result.totalCount,
      };
      return c.json(body, 200);
    }
  );

  router.delete('/breaker-tests/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await breakerTestRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Breaker test not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
