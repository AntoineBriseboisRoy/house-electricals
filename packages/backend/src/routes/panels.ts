import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  panelInputSchema,
  panelPatchSchema,
  type ApiEnvelope,
  type ApiError,
  type BreakerRepository,
  type Panel,
  type PanelRepository,
} from '@he/shared';
import { isUniqueConstraintError, uniqueNameTakenBody } from './unique-name.js';

/**
 * G39 cycle-56 — validate that wiring `panel.parentBreakerId = breakerId`
 * doesn't create a cycle (A→B→A or longer) and that the panel isn't trying
 * to feed itself.
 *
 * Returns an error message string when invalid; null when the link is OK.
 *
 * Walk: start at the candidate breaker. Look up its panel; if that panel is
 * `panelId` itself → self-feed. Otherwise check that panel's parent_breaker
 * (if any); recurse up. Bounded by a max-depth guard (panels.length + 1) so
 * a corrupted-state cycle in the DB can't infinite-loop the validator.
 */
const validateParentBreakerLink = async (
  panelId: string,
  candidateBreakerId: string,
  panelRepo: PanelRepository,
  breakerRepo: BreakerRepository
): Promise<string | null> => {
  const candidateBreaker = await breakerRepo.get(candidateBreakerId);
  if (candidateBreaker === null) {
    return 'Feeder breaker not found.';
  }
  // Self-feed: the candidate breaker belongs to the SAME panel.
  if (candidateBreaker.panelId === panelId) {
    return "A panel can't feed itself.";
  }
  // Walk up the chain from the candidate breaker's panel. If we hit panelId,
  // that means panelId is an ANCESTOR of the candidate breaker's panel —
  // wiring would create a cycle.
  const allPanels = await panelRepo.list();
  const maxDepth = allPanels.length + 1;
  let cursorPanelId: string = candidateBreaker.panelId;
  for (let depth = 0; depth < maxDepth; depth++) {
    const cursor = await panelRepo.get(cursorPanelId);
    if (cursor === null || cursor.parentBreakerId === null) return null;
    const parentBreaker = await breakerRepo.get(cursor.parentBreakerId);
    if (parentBreaker === null) return null;
    if (parentBreaker.panelId === panelId) {
      return 'That breaker would create a feeder loop (the candidate panel is already fed by this panel).';
    }
    cursorPanelId = parentBreaker.panelId;
  }
  // Hit the depth guard — assume cycle in pre-existing data.
  return 'Feeder chain too deep — possible cycle.';
};

export const buildPanelRoutes = (
  repo: PanelRepository,
  breakerRepo: BreakerRepository
): Hono => {
  const router = new Hono();

  router.get('/panels', async (c) => {
    const panels = await repo.list();
    const body: ApiEnvelope<Panel[]> = { data: panels };
    return c.json(body, 200);
  });

  router.post(
    '/panels',
    zValidator('json', panelInputSchema, (result, c) => {
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
        // Pre-create cycle check is trivial because the new panel doesn't
        // have an id yet — it can't be an ancestor. But we still need to
        // verify the candidate breaker EXISTS.
        if (input.parentBreakerId !== undefined && input.parentBreakerId !== null) {
          const candidate = await breakerRepo.get(input.parentBreakerId);
          if (candidate === null) {
            const err: ApiError = {
              error: { message: 'Feeder breaker not found.' },
            };
            return c.json(err, 400);
          }
        }
        const panel = await repo.create(input);
        const body: ApiEnvelope<Panel> = { data: panel };
        return c.json(body, 201);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(uniqueNameTakenBody(input.name), 409);
        }
        throw err;
      }
    }
  );

  router.get('/panels/:id', async (c) => {
    const id = c.req.param('id');
    const panel = await repo.get(id);
    if (panel === null) {
      const err: ApiError = { error: { message: 'Panel not found.' } };
      return c.json(err, 404);
    }
    const body: ApiEnvelope<Panel> = { data: panel };
    return c.json(body, 200);
  });

  router.patch(
    '/panels/:id',
    zValidator('json', panelPatchSchema, (result, c) => {
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

      // G39 cycle-56 — cycle detection on parentBreakerId set.
      if (
        patch.parentBreakerId !== undefined &&
        patch.parentBreakerId !== null
      ) {
        // Confirm the panel exists FIRST so cycle-validator has the right id.
        const existing = await repo.get(id);
        if (existing === null) {
          const err: ApiError = { error: { message: 'Panel not found.' } };
          return c.json(err, 404);
        }
        const cycleErr = await validateParentBreakerLink(
          id,
          patch.parentBreakerId,
          repo,
          breakerRepo
        );
        if (cycleErr !== null) {
          const err: ApiError = { error: { message: cycleErr } };
          return c.json(err, 400);
        }
      }

      try {
        const updated = await repo.update(id, patch);
        if (updated === null) {
          const err: ApiError = { error: { message: 'Panel not found.' } };
          return c.json(err, 404);
        }
        const body: ApiEnvelope<Panel> = { data: updated };
        return c.json(body, 200);
      } catch (err) {
        if (isUniqueConstraintError(err) && patch.name !== undefined) {
          return c.json(uniqueNameTakenBody(patch.name), 409);
        }
        throw err;
      }
    }
  );

  router.delete('/panels/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await repo.delete(id);
    if (!removed) {
      const err: ApiError = { error: { message: 'Panel not found.' } };
      return c.json(err, 404);
    }
    return c.body(null, 204);
  });

  return router;
};
