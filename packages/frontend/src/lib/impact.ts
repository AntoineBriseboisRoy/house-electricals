import type { Breaker, Panel, ResolvedComponent } from '@he/shared';
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
