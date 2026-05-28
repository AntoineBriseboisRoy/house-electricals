import type { Breaker, Panel } from '@he/shared';

/**
 * G39 Part 2 (cycle-57) — subpanel breaker-test recursion.
 *
 * Given the set of breakers the user has flipped off in TestPanelScreen
 * and the full house's panel + breaker tree, return:
 *
 *  - `cascadeBreakerIds`: every breaker id that is TRANSITIVELY off
 *    (its own panel's feeder chain has an off breaker somewhere
 *    upstream). EXCLUDES breakers that are themselves directly off —
 *    "direct off" wins precedence over "cascade off".
 *
 *  - `attribution`: map from a cascade-off breaker id to the closest-
 *    to-the-user subpanel name (the panel that DIRECTLY contains the
 *    breaker), for the "via <Subpanel Name>" chip.
 *
 * Walker = 2-pass BFS:
 *  - Pass 1: starting from panels whose own `parentBreakerId` is in
 *    `offBreakerIds`, BFS DOWN through panels whose parent breaker
 *    lives in an already-cascaded panel. This produces the set of
 *    "off panel ids" — every panel whose feeder chain ends at an off
 *    breaker.
 *  - Pass 2: collect every breaker in those off-panels (minus the
 *    direct-off ones). Attribute each to its containing panel's name.
 *
 * Cycle safety: cycle-56 server-side validation rejects parent chains
 * that would form a cycle, but we still cap BFS depth at the number of
 * panels as a belt-and-suspenders guard against a corrupted-state
 * cycle in the DB.
 */
export type CascadeOff = {
  cascadeBreakerIds: Set<string>;
  attribution: Map<string, string>;
};

export const computeCascadeOff = (
  offBreakerIds: ReadonlySet<string>,
  allPanels: readonly Panel[],
  breakersByPanel: ReadonlyMap<string, readonly Breaker[]>
): CascadeOff => {
  const cascadeBreakerIds = new Set<string>();
  const attribution = new Map<string, string>();

  if (offBreakerIds.size === 0) {
    return { cascadeBreakerIds, attribution };
  }

  // Build a reverse index: for each breaker id, which panel owns it?
  const ownerPanelIdByBreakerId = new Map<string, string>();
  for (const [panelId, breakers] of breakersByPanel) {
    for (const b of breakers) {
      ownerPanelIdByBreakerId.set(b.id, panelId);
    }
  }

  // Pass 1: BFS to find all "off panel ids".
  //
  // Seed = panels whose own parentBreakerId is directly off.
  const offPanelIds = new Set<string>();
  let frontier = new Set<string>();
  for (const panel of allPanels) {
    if (panel.parentBreakerId !== null && offBreakerIds.has(panel.parentBreakerId)) {
      offPanelIds.add(panel.id);
      frontier.add(panel.id);
    }
  }

  // BFS expansion: any panel whose parent breaker is owned by a panel
  // already in the cascaded set is also cascaded. Depth cap = number
  // of panels (cycle safety belt-and-suspenders).
  let depth = 0;
  const maxDepth = allPanels.length + 1;
  while (frontier.size > 0 && depth < maxDepth) {
    const next = new Set<string>();
    for (const panel of allPanels) {
      if (offPanelIds.has(panel.id)) continue;
      if (panel.parentBreakerId === null) continue;
      const ownerPanelId = ownerPanelIdByBreakerId.get(panel.parentBreakerId);
      if (ownerPanelId && frontier.has(ownerPanelId)) {
        offPanelIds.add(panel.id);
        next.add(panel.id);
      }
    }
    frontier = next;
    depth += 1;
  }

  // Pass 2: collect cascade-off breakers from those panels with
  // attribution = the panel's name. Direct-off wins precedence.
  for (const offPanelId of offPanelIds) {
    const panel = allPanels.find((p) => p.id === offPanelId);
    if (!panel) continue;
    const breakers = breakersByPanel.get(offPanelId) ?? [];
    for (const b of breakers) {
      if (offBreakerIds.has(b.id)) continue; // direct-off wins
      cascadeBreakerIds.add(b.id);
      attribution.set(b.id, panel.name);
    }
  }

  return { cascadeBreakerIds, attribution };
};
