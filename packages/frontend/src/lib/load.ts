import type { Breaker, Component, ComponentType } from '@he/shared';

/**
 * Per-circuit load tracking (2026-05).
 *
 * Estimates how loaded a breaker is: sum the watts of the components wired
 * to it, compare against the breaker's continuous-load capacity.
 *
 * NEC continuous-load rule: a circuit should run at no more than 80% of its
 * rated capacity continuously. So usable capacity = amperage × volts × 0.8.
 * Volts by poles: single/tandem = 120 V, double-pole = 240 V.
 *
 * Status thresholds are relative to THAT (already-derated) capacity:
 *   > 100% → over (danger), > 80% → warn, else ok.
 */

export const CONTINUOUS_FACTOR = 0.8;

/** Nominal volts for a breaker by pole count (tandem + single = 120). */
export const breakerVolts = (breaker: Pick<Breaker, 'poles'>): number =>
  breaker.poles === 'double' ? 240 : 120;

/** Continuous-load capacity in watts (amperage × volts × 0.8). */
export const breakerCapacityWatts = (
  breaker: Pick<Breaker, 'poles' | 'amperage'>
): number =>
  Math.round(breaker.amperage * breakerVolts(breaker) * CONTINUOUS_FACTOR);

/** Sum of known load. A null loadWatts (unknown) contributes 0. */
export const sumLoadWatts = (
  components: ReadonlyArray<Pick<Component, 'loadWatts'>>
): number => components.reduce((acc, c) => acc + (c.loadWatts ?? 0), 0);

export type LoadStatus = 'ok' | 'warn' | 'over';

export const loadStatus = (loadW: number, capacityW: number): LoadStatus => {
  if (capacityW <= 0) return 'ok';
  const pct = loadW / capacityW;
  if (pct > 1) return 'over';
  if (pct > 0.8) return 'warn';
  return 'ok';
};

export type BreakerLoad = {
  /** Sum of wired components' loadWatts (unknown counted as 0). */
  watts: number;
  /** Continuous-load capacity (amperage × volts × 0.8). */
  capacity: number;
  /** watts / capacity (0..>1). 0 when capacity is 0. */
  pct: number;
  status: LoadStatus;
};

export const computeBreakerLoad = (
  breaker: Pick<Breaker, 'poles' | 'amperage'>,
  components: ReadonlyArray<Pick<Component, 'loadWatts'>>
): BreakerLoad => {
  const watts = sumLoadWatts(components);
  const capacity = breakerCapacityWatts(breaker);
  const pct = capacity > 0 ? watts / capacity : 0;
  return { watts, capacity, pct, status: loadStatus(watts, capacity) };
};

/** Typical continuous-load defaults OFFERED in the component form (watts).
 *  null = no sensible default (user supplies / leaves unknown). Switches and
 *  junction boxes draw no load themselves (they route/control). */
export const TYPICAL_LOAD_WATTS: Record<ComponentType, number | null> = {
  outlet: 180,
  light: 60,
  appliance: 1500,
  switch: 0,
  junction_box: 0,
  smoke_detector: 5,
  other: null,
};

/** "1,440 W" — locale-grouped integer watts. */
export const formatWatts = (w: number): string => `${Math.round(w).toLocaleString()} W`;
