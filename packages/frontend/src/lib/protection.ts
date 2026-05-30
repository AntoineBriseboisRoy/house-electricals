/**
 * Protection roll-up helpers (G45 — 2026-05).
 *
 * Pure helpers — NO React, NO fetch. The single source of truth for the
 * "GFCI/AFCI untested this month" filter, shared between PanelListScreen
 * (the cycle-69 aggregate card) and the G45 status dashboard.
 *
 * This re-DISPLAYS an already-computed signal: it does NOT do code-compliance
 * auditing or "circuit missing required protection" inference. It only filters
 * the caller-supplied protected breakers by their latest-test timestamp.
 */
import type { Breaker } from '@he/shared';

/**
 * Given the protected (GFCI/AFCI/dual) breakers and a Map of each breaker's
 * latest breaker_test timestamp (epoch ms, or null when never tested),
 * return the subset that are "untested this month".
 *
 * A breaker is untested-this-month when its latest test is null OR strictly
 * before `monthStart`. A Map miss (load still in flight) is also treated as
 * untested so the signal surfaces eagerly and self-corrects once tests load —
 * this preserves the exact cycle-69 inline behavior verbatim.
 */
export const filterUntestedProtected = (
  protectedBreakers: Breaker[],
  latestTestByBreaker: Map<string, number | null>,
  monthStart: number
): Breaker[] => {
  return protectedBreakers.filter((b) => {
    const last = latestTestByBreaker.get(b.id);
    // Map miss (load in flight) → treat as untested so the card surfaces
    // eagerly; once tests load it self-corrects.
    if (last === undefined || last === null) return true;
    return last < monthStart;
  });
};
