import type { Breaker, Panel, ResolvedComponent, SwitchControl } from '@he/shared';
import { computeCascadeOff } from './subpanelRecursion.js';

/**
 * G35 Part 1 (cycle-58) — Impact modal helper.
 *
 * Given the breaker the user is curious about (`breakerId`), return the
 * list of components that would lose power if that breaker were flipped
 * off.
 *
 * IMPORTANT — NO switch_controls leg.
 * VISION G35 originally hinted at a "transitive via switch_controls"
 * edge: a switch on the off breaker would propagate to the lights it
 * controls. That framing is electrically wrong. A switch losing power
 * doesn't kill the light it toggles — the light has its own circuit
 * (its own breaker feed); the switch is signal logic, not power
 * supply. Killing the switch's breaker only means the user can't
 * toggle the light FROM THAT SWITCH; the light still has power. A
 * future cycle MAY add a separate "Switches that lose control"
 * surface, but it does NOT belong in the "loses power" Impact modal.
 *
 * The transitive edge that IS valid is subpanel feeder chains. Those
 * are computed via cycle-57's `computeCascadeOff` — when the off
 * breaker happens to feed a subpanel, every breaker in that subpanel
 * (and any subsubpanels recursively) is also off, and so are the
 * components controlled by those breakers.
 */
export type ImpactItem = {
  component: ResolvedComponent;
  /** 'direct' = this breaker controls it; 'cascade' = a feeder kills it. */
  reason: 'direct' | 'cascade';
  /** When cascade: name of the subpanel where the controlling breaker lives. */
  viaSubpanel?: string;
};

export const computeImpact = (
  breakerId: string,
  allComponents: readonly ResolvedComponent[],
  allPanels: readonly Panel[],
  breakersByPanel: ReadonlyMap<string, readonly Breaker[]>
): ImpactItem[] => {
  const offSet = new Set<string>([breakerId]);
  const { cascadeBreakerIds, attribution } = computeCascadeOff(
    offSet,
    allPanels,
    breakersByPanel
  );

  const items: ImpactItem[] = [];
  for (const c of allComponents) {
    if (c.breakerId === breakerId) {
      items.push({ component: c, reason: 'direct' });
    } else if (
      c.breakerId !== null &&
      cascadeBreakerIds.has(c.breakerId)
    ) {
      const via = attribution.get(c.breakerId);
      items.push({
        component: c,
        reason: 'cascade',
        viaSubpanel: via,
      });
    }
  }
  return items;
};

/**
 * 2026-05 — the deferred companion to computeImpact (cycle-58 ADR #1).
 *
 * Flipping a breaker off doesn't kill a light a switch *controls* — that light
 * has its own circuit. But it DOES cut power to any SWITCH on the off breaker
 * (direct or via a subpanel feeder), so you can no longer toggle that switch's
 * lights/outlets *from that switch*. This computes that: for each switch that
 * loses power, the lights/outlets it controls that KEEP power (i.e. are not
 * themselves in the off-set — those already show in computeImpact).
 */
export type SwitchControlLoss = {
  switchComponent: ResolvedComponent;
  /** Lights/outlets controlled by this switch that stay powered but can no
   *  longer be toggled from it. */
  controlled: ResolvedComponent[];
};

export const computeSwitchControlLoss = (
  breakerId: string,
  allComponents: readonly ResolvedComponent[],
  allPanels: readonly Panel[],
  breakersByPanel: ReadonlyMap<string, readonly Breaker[]>,
  switchControls: readonly SwitchControl[]
): SwitchControlLoss[] => {
  const offSet = new Set<string>([breakerId]);
  const { cascadeBreakerIds } = computeCascadeOff(offSet, allPanels, breakersByPanel);
  const isOff = (bid: string | null): boolean =>
    bid !== null && (bid === breakerId || cascadeBreakerIds.has(bid));

  const byId = new Map(allComponents.map((c) => [c.id, c]));
  const controlledBySwitch = new Map<string, Set<string>>();
  for (const sc of switchControls) {
    let set = controlledBySwitch.get(sc.switchId);
    if (set === undefined) {
      set = new Set();
      controlledBySwitch.set(sc.switchId, set);
    }
    set.add(sc.controlledId);
  }

  const losses: SwitchControlLoss[] = [];
  for (const sw of allComponents) {
    if (sw.type !== 'switch') continue;
    if (!isOff(sw.breakerId)) continue;
    const ids = controlledBySwitch.get(sw.id);
    if (ids === undefined || ids.size === 0) continue;
    const controlled: ResolvedComponent[] = [];
    for (const cid of ids) {
      const c = byId.get(cid);
      if (c === undefined) continue;
      // Skip ones that ALSO lose power — they're already in computeImpact's
      // list; "loses control" only matters for components that stay powered.
      if (isOff(c.breakerId)) continue;
      controlled.push(c);
    }
    if (controlled.length > 0) {
      controlled.sort((a, b) => a.name.localeCompare(b.name));
      losses.push({ switchComponent: sw, controlled });
    }
  }
  losses.sort((a, b) =>
    a.switchComponent.name.localeCompare(b.switchComponent.name)
  );
  return losses;
};
