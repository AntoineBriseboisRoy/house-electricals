import type { Breaker, Component, Panel } from '@he/shared';
import { computeCascadeOff } from './subpanelRecursion.js';

/**
 * 2026-05 — persistent breaker on/off propagation.
 *
 * A breaker can be marked OFF (`breaker.isOn === false`). "Off" propagates:
 *  - DIRECT: the breaker itself is off → its wired components are de-energized.
 *  - CASCADE: a feeder breaker that feeds a subpanel is off → every breaker on
 *    that subpanel (and sub-subpanels) is also off, via `computeCascadeOff`.
 *
 * `OffState` is the precomputed answer to "is breaker/component X off?" for a
 * whole house. Build it once per render from the full panel + breaker tree,
 * then query cheaply with `isBreakerOff` / `isComponentOff`. The `attribution`
 * map names the subpanel a cascade-off breaker hangs off of (for "via <panel>"
 * chips), mirroring the cycle-57 TestPanelScreen treatment.
 */
export type OffState = {
  /** Breakers the user marked off directly (isOn === false). */
  directOffIds: ReadonlySet<string>;
  /** Breakers off only because an upstream feeder is off. */
  cascadeOffIds: ReadonlySet<string>;
  /** cascade-off breaker id → the subpanel name it hangs off of. */
  attribution: ReadonlyMap<string, string>;
};

export const EMPTY_OFF_STATE: OffState = {
  directOffIds: new Set(),
  cascadeOffIds: new Set(),
  attribution: new Map(),
};

/** Build an OffState from the full house tree. */
export const computeOffState = (
  allPanels: readonly Panel[],
  breakersByPanel: ReadonlyMap<string, readonly Breaker[]>
): OffState => {
  const directOffIds = new Set<string>();
  for (const breakers of breakersByPanel.values()) {
    for (const b of breakers) {
      if (!b.isOn) directOffIds.add(b.id);
    }
  }
  const cascade = computeCascadeOff(directOffIds, allPanels, breakersByPanel);
  return {
    directOffIds,
    cascadeOffIds: cascade.cascadeBreakerIds,
    attribution: cascade.attribution,
  };
};

/** Convenience: build the breakersByPanel map from a flat panels+breakers list. */
export const groupBreakersByPanel = (
  panelBreakerPairs: ReadonlyArray<{ panel: Panel; breakers: readonly Breaker[] }>
): Map<string, readonly Breaker[]> =>
  new Map(panelBreakerPairs.map((g) => [g.panel.id, g.breakers]));

/** True when the breaker is off directly OR via an upstream feeder. */
export const isBreakerOff = (off: OffState, breakerId: string): boolean =>
  off.directOffIds.has(breakerId) || off.cascadeOffIds.has(breakerId);

/** True when the component is wired to an off breaker (direct or cascade). */
export const isComponentOff = (
  off: OffState,
  component: Pick<Component, 'breakerId'>
): boolean =>
  component.breakerId !== null && isBreakerOff(off, component.breakerId);

/** The subpanel name a breaker is off "via", or null if direct/not-off. A
 *  direct-off breaker returns null (the user already knows they flipped it). */
export const offVia = (off: OffState, breakerId: string): string | null => {
  if (off.directOffIds.has(breakerId)) return null;
  return off.attribution.get(breakerId) ?? null;
};
