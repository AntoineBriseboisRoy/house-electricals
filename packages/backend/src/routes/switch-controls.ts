import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Db } from '../db.js';
import {
  switchControlInputSchema,
  type ApiEnvelope,
  type ApiError,
  type ComponentRepository,
  type ResolvedSwitchControl,
  type SwitchControl,
} from '@he/shared';

/**
 * Switch-control routes (G19 + G38 cycle-64).
 *
 * - GET    /api/v1/components/:id/controls
 *     → ResolvedSwitchControl[] for the given switch (one row per gang-link)
 * - POST   /api/v1/components/:id/controls   body: {gangIndex, controlledId}
 *     → 201 with the new ResolvedSwitchControl
 * - DELETE /api/v1/components/:id/controls/:gangIndex/:controlledId
 *     → 204
 * - GET    /api/v1/switch-controls?floorId=<id>   (G38 cycle-64)
 *     → SwitchControl[] for any link where EITHER the switch OR the
 *       controlled component lives on the given floor. Flat per the
 *       CLAUDE.md "Reverse views" rule.
 *
 * Validation: switch_id must reference a component with type='switch';
 * controlled_id must reference a light or outlet. Gang index must be
 * within the switch's gangs count.
 */
export const buildSwitchControlRoutes = (
  db: Db,
  componentRepo: ComponentRepository
): Hono => {
  const router = new Hono();

  // G38 cycle-64 — flat list endpoint scoped by floor. Returns plain
  // SwitchControl rows (NOT ResolvedSwitchControl) — the frontend already
  // has the component data loaded for the floor and only needs the
  // (switchId, gangIndex, controlledId) triples to build its memos.
  router.get('/switch-controls', async (c) => {
    // Scope by floor (G38 cycle-64) OR by building (2026-05 — used by the
    // Impact view's "switches that lose control" section). Exactly one is
    // required. The scope column is a fixed whitelist, never user text, so
    // interpolating it into the SQL is injection-safe.
    const floorId = c.req.query('floorId');
    const buildingId = c.req.query('buildingId');
    const hasFloor = floorId !== undefined && floorId.length > 0;
    const hasBuilding = buildingId !== undefined && buildingId.length > 0;
    if (!hasFloor && !hasBuilding) {
      const err: ApiError = {
        error: { message: 'floorId or buildingId query parameter is required.' },
      };
      return c.json(err, 400);
    }
    const scopeCol = hasFloor ? 'floor_id' : 'building_id';
    const scopeVal = hasFloor ? (floorId as string) : (buildingId as string);
    type Row = {
      switch_id: string;
      gang_index: number;
      controlled_id: string;
    };
    // A control row is included when EITHER the switch OR the controlled
    // component matches the scope. Two JOINs on components → either side
    // matches → use OR.
    const rows = await db.query<Row>(
      `SELECT sc.switch_id, sc.gang_index, sc.controlled_id
         FROM switch_controls sc
         LEFT JOIN components sw  ON sw.id  = sc.switch_id
         LEFT JOIN components ctl ON ctl.id = sc.controlled_id
         WHERE sw.${scopeCol} = $1 OR ctl.${scopeCol} = $1
         ORDER BY sc.switch_id ASC, sc.gang_index ASC, sc.controlled_id ASC`,
      [scopeVal]
    );
    const data: SwitchControl[] = rows.map((r) => ({
      switchId: r.switch_id,
      gangIndex: r.gang_index,
      controlledId: r.controlled_id,
    }));
    const body: ApiEnvelope<SwitchControl[]> = { data };
    return c.json(body, 200);
  });

  router.get('/components/:id/controls', async (c) => {
    const id = c.req.param('id');
    const sw = await componentRepo.get(id);
    if (sw === null) {
      const err: ApiError = { error: { message: 'Component not found.' } };
      return c.json(err, 404);
    }
    // Pull links + join controlled component data via the repo (one query per
    // link is fine — N is small, typically 1-8 per switch).
    type LinkRow = { gang_index: number; controlled_id: string };
    const links = await db.query<LinkRow>(
      'SELECT gang_index, controlled_id FROM switch_controls WHERE switch_id = $1 ORDER BY gang_index ASC, controlled_id ASC',
      [id]
    );
    const resolved: ResolvedSwitchControl[] = [];
    for (const l of links) {
      const controlled = await componentRepo.get(l.controlled_id);
      if (controlled === null) continue; // shouldn't happen with FK CASCADE
      resolved.push({
        switchId: id,
        gangIndex: l.gang_index,
        controlled,
      });
    }
    const body: ApiEnvelope<ResolvedSwitchControl[]> = { data: resolved };
    return c.json(body, 200);
  });

  router.post(
    '/components/:id/controls',
    zValidator('json', switchControlInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = {
          error: { message: result.error.issues[0]?.message ?? 'Invalid body.' },
        };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const switchId = c.req.param('id');
      const { gangIndex, controlledId } = c.req.valid('json');
      const sw = await componentRepo.get(switchId);
      if (sw === null) {
        const err: ApiError = { error: { message: 'Switch not found.' } };
        return c.json(err, 404);
      }
      if (sw.type !== 'switch') {
        const err: ApiError = { error: { message: 'Component is not a switch.' } };
        return c.json(err, 400);
      }
      if (gangIndex >= sw.gangs) {
        const err: ApiError = {
          error: {
            message: `Gang index ${gangIndex} is out of range (switch has ${sw.gangs} gangs).`,
          },
        };
        return c.json(err, 400);
      }
      const controlled = await componentRepo.get(controlledId);
      if (controlled === null) {
        const err: ApiError = { error: { message: 'Controlled component not found.' } };
        return c.json(err, 400);
      }
      if (controlled.type !== 'light' && controlled.type !== 'outlet') {
        const err: ApiError = {
          error: {
            message: 'Controlled component must be a light or an outlet.',
          },
        };
        return c.json(err, 400);
      }
      // Composite PK enforces uniqueness; ON CONFLICT DO NOTHING makes the
      // call idempotent (re-linking the same pair is a no-op).
      await db.execute(
        'INSERT INTO switch_controls (switch_id, gang_index, controlled_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [switchId, gangIndex, controlledId]
      );

      // Refactor 2026-05 follow-up — switch+controlled share one circuit.
      // When a new control link is added, sync the controlled component's
      // breakerId to whatever the switch currently has. If the switch is
      // unwired (sw.breakerId === null), the controlled also goes unwired
      // — keeps the "switch.breakerId === controlled.breakerId" invariant
      // simple. The user can wire/rewire the switch later and the matching
      // UPDATE path propagates to all controlled components in one shot.
      // Skipped when controlled is already on the right breaker so we
      // don't fire a redundant write.
      let resolvedControlled = controlled;
      if (controlled.breakerId !== sw.breakerId) {
        const updated = await componentRepo.update(controlledId, {
          breakerId: sw.breakerId,
        });
        if (updated !== null) {
          resolvedControlled = { ...controlled, breakerId: sw.breakerId };
        }
      }
      const body: ApiEnvelope<ResolvedSwitchControl> = {
        data: { switchId, gangIndex, controlled: resolvedControlled },
      };
      return c.json(body, 201);
    }
  );

  router.delete('/components/:id/controls/:gangIndex/:controlledId', async (c) => {
    const switchId = c.req.param('id');
    const gangIndex = Number.parseInt(c.req.param('gangIndex'), 10);
    const controlledId = c.req.param('controlledId');
    if (!Number.isFinite(gangIndex) || gangIndex < 0 || gangIndex > 7) {
      const err: ApiError = { error: { message: 'Invalid gang index.' } };
      return c.json(err, 400);
    }
    const changed = await db.execute(
      'DELETE FROM switch_controls WHERE switch_id = $1 AND gang_index = $2 AND controlled_id = $3',
      [switchId, gangIndex, controlledId]
    );
    if (changed === 0) {
      const err: ApiError = { error: { message: 'Control link not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
