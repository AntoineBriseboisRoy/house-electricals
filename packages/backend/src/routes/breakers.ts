import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  breakerInputSchema,
  breakerPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type Breaker,
  type BreakerInput,
  type BreakerRepository,
  type Panel,
  type PanelRepository,
} from '@he/shared';

/**
 * G33 cycle-41 / G34 cycle-42 — server-side slot validation.
 *
 * Rules:
 *  - `slot` must parse to an integer in [1, panel.slotCount].
 *  - **Single + double pole**: that slot must not be occupied at all.
 *    For double-pole: slot+1 must also be in range and free.
 *  - **Tandem**: a tandem must specify `tandemHalf` ('a' or 'b'). A
 *    tandem-half may coexist with the OTHER tandem-half on the same slot
 *    (one 'a' + one 'b'), but never with a non-tandem breaker, and never
 *    with another tandem of the same half.
 *  - Non-tandem (single + double) breakers must NOT carry a tandemHalf.
 */
const validateSlotAssignment = (
  input: Pick<BreakerInput, 'slot' | 'poles' | 'tandemHalf'>,
  panel: Panel,
  siblings: Breaker[],
  excludeBreakerId?: string
): string | null => {
  const n = Number.parseInt(input.slot, 10);
  if (!Number.isFinite(n) || String(n) !== input.slot.trim()) {
    return 'Slot must be a whole number.';
  }
  if (n < 1) return 'Slot must be at least 1.';
  if (n > panel.slotCount) {
    return `This panel has ${panel.slotCount} slots — pick 1–${panel.slotCount}.`;
  }

  // G34 — tandemHalf cross-field rules.
  if (input.poles === 'tandem') {
    if (input.tandemHalf !== 'a' && input.tandemHalf !== 'b') {
      return 'Tandem breakers must pick a half (a or b).';
    }
  } else {
    if (input.tandemHalf !== null && input.tandemHalf !== undefined) {
      return 'Only tandem breakers may carry a tandem half.';
    }
  }

  // Build occupancy view. For each slot position, we track which breakers
  // (by id) sit there + what flavor: 'full' (single/double), 'tandem-a',
  // 'tandem-b'. A 'full' excludes everything else on its slot. Two tandem
  // halves of opposite letters can coexist; same-letter cannot.
  type Occupant = { id: string; flavor: 'full' | 'tandem-a' | 'tandem-b' };
  const occupiedAt = new Map<number, Occupant[]>();
  const push = (slotN: number, o: Occupant): void => {
    const arr = occupiedAt.get(slotN);
    if (arr) arr.push(o);
    else occupiedAt.set(slotN, [o]);
  };
  for (const b of siblings) {
    if (b.id === excludeBreakerId) continue;
    if (b.slotPosition === null) continue;
    if (b.poles === 'tandem') {
      if (b.tandemHalf === 'a' || b.tandemHalf === 'b') {
        push(b.slotPosition, {
          id: b.id,
          flavor: b.tandemHalf === 'a' ? 'tandem-a' : 'tandem-b',
        });
      }
      // tandem with NULL half = legacy data, treat as 'a' occupant
      else push(b.slotPosition, { id: b.id, flavor: 'tandem-a' });
    } else {
      push(b.slotPosition, { id: b.id, flavor: 'full' });
      if (b.poles === 'double') {
        push(b.slotPosition + 1, { id: b.id, flavor: 'full' });
      }
    }
  }

  const at = occupiedAt.get(n) ?? [];
  if (input.poles === 'tandem') {
    // 'a' can only land if no 'full' and no other 'a' is here.
    const sameFlavor =
      input.tandemHalf === 'a' ? 'tandem-a' : 'tandem-b';
    if (at.some((o) => o.flavor === 'full')) {
      return `Slot ${n} is already taken by a non-tandem breaker — tandem halves can't share with single/double-pole.`;
    }
    if (at.some((o) => o.flavor === sameFlavor)) {
      return `Slot ${n}${input.tandemHalf} is already taken by another tandem breaker.`;
    }
  } else {
    // single + double: slot must be empty (no full + no tandem halves).
    if (at.length > 0) {
      return `Slot ${n} is already taken by another breaker.`;
    }
    if (input.poles === 'double') {
      if (n + 1 > panel.slotCount) {
        return `A double-pole breaker spans slots ${n}+${n + 1}, but slot ${n + 1} is past the panel's ${panel.slotCount}-slot limit.`;
      }
      const at2 = occupiedAt.get(n + 1) ?? [];
      if (at2.length > 0) {
        return `A double-pole breaker would also need slot ${n + 1}, but that's already taken.`;
      }
    }
  }
  return null;
};

export const buildBreakerRoutes = (
  panelRepo: PanelRepository,
  breakerRepo: BreakerRepository
): Hono => {
  const router = new Hono();

  router.get('/panels/:panelId/breakers', async (c) => {
    const panelId = c.req.param('panelId');
    const panel = await panelRepo.get(panelId);
    if (panel === null) {
      const err: ApiError = { error: { message: 'Panel not found.' } };
      return c.json(err, 404);
    }
    const breakers = await breakerRepo.listByPanel(panelId);
    const body: ApiEnvelope<Breaker[]> = { data: breakers };
    return c.json(body, 200);
  });

  router.post(
    '/panels/:panelId/breakers',
    zValidator('json', breakerInputSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = { error: { message: result.error.issues[0]?.message ?? 'Invalid body.' } };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const panelId = c.req.param('panelId');
      const panel = await panelRepo.get(panelId);
      if (panel === null) {
        const err: ApiError = { error: { message: 'Panel not found.' } };
        return c.json(err, 404);
      }
      const input = c.req.valid('json');
      // G33 — strict slot validation: integer, in panel range, no collisions.
      const siblings = await breakerRepo.listByPanel(panelId);
      const slotError = validateSlotAssignment(input, panel, siblings);
      if (slotError !== null) {
        const err: ApiError = { error: { message: slotError } };
        return c.json(err, 400);
      }
      // Auto-set slotPosition to match the integer slot (the form already
      // does this; mirror server-side so direct API calls behave the same).
      const slotN = Number.parseInt(input.slot, 10);
      const inputWithPosition: BreakerInput = {
        ...input,
        slotPosition: input.slotPosition ?? slotN,
      };
      const breaker = await breakerRepo.create(panelId, inputWithPosition);
      const body: ApiEnvelope<Breaker> = { data: breaker };
      return c.json(body, 201);
    }
  );

  router.get('/breakers/:id', async (c) => {
    const id = c.req.param('id');
    const breaker = await breakerRepo.get(id);
    if (breaker === null) {
      const err: ApiError = { error: { message: 'Breaker not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Breaker> = { data: breaker };
    return c.json(body, 200);
  });

  router.patch(
    '/breakers/:id',
    zValidator('json', breakerPatchSchema, (result, c) => {
      if (!result.success) {
        const err: ApiError = { error: { message: result.error.issues[0]?.message ?? 'Invalid body.' } };
        return c.json(err, 400);
      }
      return undefined;
    }),
    async (c) => {
      const id = c.req.param('id');
      const patch = c.req.valid('json');
      // G33 — if the patch touches slot OR poles OR tandemHalf, re-validate
      // against the panel + siblings. Only patches that change none of these
      // fields skip the slot check (e.g. relabeling, changing amperage).
      if (
        patch.slot !== undefined ||
        patch.poles !== undefined ||
        patch.tandemHalf !== undefined
      ) {
        const existing = await breakerRepo.get(id);
        if (existing === null) {
          const err: ApiError = { error: { message: 'Breaker not found.' } };
          return c.json(err, 404);
        }
        const panel = await panelRepo.get(existing.panelId);
        if (panel === null) {
          const err: ApiError = { error: { message: 'Panel not found.' } };
          return c.json(err, 404);
        }
        const siblings = await breakerRepo.listByPanel(existing.panelId);
        const slotError = validateSlotAssignment(
          {
            slot: patch.slot ?? existing.slot,
            poles: patch.poles ?? existing.poles,
            // G34: thread tandemHalf through. If the patch flips poles to
            // non-tandem, the validator will treat tandemHalf as null;
            // if poles stays tandem, the patch's tandemHalf (or existing's)
            // gets evaluated.
            tandemHalf:
              patch.tandemHalf === undefined
                ? existing.tandemHalf
                : patch.tandemHalf,
          },
          panel,
          siblings,
          id
        );
        if (slotError !== null) {
          const err: ApiError = { error: { message: slotError } };
          return c.json(err, 400);
        }
        // Mirror the front-end's auto-sync: if slot changed, sync slotPosition.
        if (patch.slot !== undefined) {
          const slotN = Number.parseInt(patch.slot, 10);
          if (Number.isFinite(slotN)) {
            patch.slotPosition = slotN;
          }
        }
      }
      const updated = await breakerRepo.update(id, patch);
      if (updated === null) {
        const err: ApiError = { error: { message: 'Breaker not found.' } };
        return c.json(err, 404);
      }
      const body: ApiEnvelope<Breaker> = { data: updated };
      return c.json(body, 200);
    }
  );

  router.delete('/breakers/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await breakerRepo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Breaker not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
