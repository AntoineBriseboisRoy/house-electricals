import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  warningDismissalInputSchema,
  type ApiEnvelope,
  type ApiError,
  type WarningDismissal,
} from '@he/shared';
import type { Db } from '../db.js';

/**
 * Warning dismissals (2026-05).
 *
 * Persists a user's "dismiss this warning" choice, scoped by
 * (building_id, kind, period_start) so it auto-expires. The first consumer is
 * the monthly GFCI/AFCI "untested this month" banner: dismissing writes a row
 * for the CURRENT month-start; next month the period key changes so the banner
 * is live again with no cleanup.
 *
 * - GET  /api/v1/warning-dismissals?buildingId=<id>[&kind=<kind>]
 *     → WarningDismissal[] for the building (optionally filtered to one kind).
 * - POST /api/v1/warning-dismissals  body {buildingId, kind, periodStart}
 *     → 201 with the dismissal. Idempotent (ON CONFLICT DO NOTHING) so a
 *       double-tap is a safe no-op.
 *
 * Queries `db` directly (no dedicated repo class) — same precedent as the flat
 * switch-controls route: a thin auxiliary table not worth a full repository.
 */

type DismissalRow = {
  building_id: string;
  kind: string;
  period_start: number;
  created_at: number;
};

const rowToDismissal = (r: DismissalRow): WarningDismissal => ({
  buildingId: r.building_id,
  kind: r.kind as WarningDismissal['kind'],
  periodStart: r.period_start,
  createdAt: r.created_at,
});

export const buildWarningDismissalRoutes = (db: Db): Hono => {
  const router = new Hono();

  router.get('/warning-dismissals', async (c) => {
    const buildingId = c.req.query('buildingId');
    if (buildingId === undefined || buildingId.length === 0) {
      const err: ApiError = {
        error: { message: 'buildingId query parameter is required.' },
      };
      return c.json(err, 400);
    }
    const kind = c.req.query('kind');
    const rows =
      kind !== undefined && kind.length > 0
        ? await db.query<DismissalRow>(
            `SELECT building_id, kind, period_start, created_at
               FROM warning_dismissals
              WHERE building_id = $1 AND kind = $2
              ORDER BY period_start DESC`,
            [buildingId, kind]
          )
        : await db.query<DismissalRow>(
            `SELECT building_id, kind, period_start, created_at
               FROM warning_dismissals
              WHERE building_id = $1
              ORDER BY period_start DESC`,
            [buildingId]
          );
    const body: ApiEnvelope<WarningDismissal[]> = {
      data: rows.map(rowToDismissal),
    };
    return c.json(body, 200);
  });

  router.post(
    '/warning-dismissals',
    zValidator('json', warningDismissalInputSchema, (result, c) => {
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
      // Idempotent insert — a second dismiss for the same (building, kind,
      // period) is a no-op. ON CONFLICT keeps the original created_at.
      await db.execute(
        `INSERT INTO warning_dismissals (building_id, kind, period_start, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (building_id, kind, period_start) DO NOTHING`,
        [input.buildingId, input.kind, input.periodStart, Date.now()]
      );
      const dismissal: WarningDismissal = {
        buildingId: input.buildingId,
        kind: input.kind,
        periodStart: input.periodStart,
        createdAt: Date.now(),
      };
      const body: ApiEnvelope<WarningDismissal> = { data: dismissal };
      return c.json(body, 201);
    }
  );

  return router;
};
