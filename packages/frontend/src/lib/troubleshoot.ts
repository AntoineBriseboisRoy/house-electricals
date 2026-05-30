import type {
  Breaker,
  Component,
  Panel,
  ProtectionKind,
  SwitchControl,
} from '@he/shared';
import { computeBreakerLoad, type BreakerLoad } from './load.js';

/**
 * Guided troubleshooting (2026-05) — the reverse of the Impact view.
 *
 * Impact answers "if I flip THIS breaker, what dies?". Troubleshoot answers the
 * everyday emergency: "this device has no power — what do I check?". Given a
 * single component, it traces its circuit and emits an ordered, plain-language
 * action list.
 *
 * The step ORDER + content is validated against authoritative homeowner
 * troubleshooting guides (Eaton "How to fix an outlet that is not working";
 * Family Handyman "Why your outlet stopped working"). The canonical sequence
 * those sources agree on is: (safety check for danger signs) → reset GFCI →
 * check the breaker → check the wall switch → test nearby devices to tell a
 * local fault from a whole-circuit one → call a pro if unresolved. We add the
 * AFCI variant (a real NEC breaker type that resets at the panel), the
 * subpanel-feeder hop (a tripped feeder kills everything downstream), and an
 * overload note (repeated tripping = overload/fault → electrician) — all real
 * causes. The SAFETY step is surfaced FIRST so a user never repeatedly resets
 * a breaker that is tripping on a genuine fault.
 *
 * PURE — no I/O, no React. Reuses the cycle-56/57 feeder model + the load
 * helper. Unit-tested in troubleshoot.test.ts.
 */

export type TroubleshootStepKind =
  | 'unwired'
  | 'safety'
  | 'gfci'
  | 'afci'
  | 'switch'
  | 'breaker'
  | 'feeder'
  | 'overload'
  | 'isolate';

export type TroubleshootStep = {
  kind: TroubleshootStepKind;
  title: string;
  detail: string;
  /** Optional deep-link to the controlling panel, using the cycle-22/23
   *  `#breaker-<id>` hash contract (pulses the slot on PanelDetail). */
  href?: string;
};

/** One link in the upstream feeder chain (subpanel → its feeder breaker). */
export type FeederLink = {
  feederBreaker: Breaker;
  feederPanel: Panel;
  subPanel: Panel;
};

export type Diagnosis = {
  component: Component;
  /** The breaker controlling this device (via component.breakerId), or null. */
  breaker: Breaker | null;
  panel: Panel | null;
  /** Resolved protection: the component's own wins (e.g. a GFCI receptacle),
   *  else the breaker's. */
  protection: ProtectionKind | null;
  protectionSource: 'breaker' | 'component' | null;
  /** Switches that toggle this device (reverse switch-control lookup). */
  controllingSwitches: Component[];
  /** Other components on the same breaker (excludes the device itself). */
  circuitMates: Component[];
  /** Upstream feeder breakers, nearest first (empty for top-level panels). */
  feederChain: FeederLink[];
  /** Load on the circuit (includes the device), or null when unwired. */
  load: BreakerLoad | null;
  /** Ordered, deduplicated action steps. */
  steps: TroubleshootStep[];
};

export type TroubleshootInput = {
  component: Component;
  allComponents: readonly Component[];
  allPanels: readonly Panel[];
  breakersByPanel: ReadonlyMap<string, readonly Breaker[]>;
  switchControls: readonly SwitchControl[];
};

const slotLabel = (b: Breaker): string => `Slot ${b.slot}${b.tandemHalf ?? ''}`;
const breakerName = (b: Breaker): string => b.label || slotLabel(b);

/** Deep-link to a breaker's panel (cycle-22/23 hash pulse contract). */
export const breakerHref = (panelId: string, breakerId: string): string =>
  `/panels/${panelId}#breaker-${breakerId}`;

/**
 * Trace a single component's circuit and produce a guided diagnosis.
 */
export const diagnose = (input: TroubleshootInput): Diagnosis => {
  const { component, allComponents, allPanels, breakersByPanel, switchControls } =
    input;

  // Index the tree once.
  const breakerById = new Map<string, Breaker>();
  const panelById = new Map<string, Panel>();
  for (const p of allPanels) {
    panelById.set(p.id, p);
    for (const b of breakersByPanel.get(p.id) ?? []) breakerById.set(b.id, b);
  }

  const breaker =
    component.breakerId !== null
      ? breakerById.get(component.breakerId) ?? null
      : null;
  const panel = breaker !== null ? panelById.get(breaker.panelId) ?? null : null;

  // Protection: the component's own (a GFCI receptacle) wins over the breaker's.
  let protection: ProtectionKind | null = null;
  let protectionSource: 'breaker' | 'component' | null = null;
  if (component.protection !== null) {
    protection = component.protection;
    protectionSource = 'component';
  } else if (breaker !== null && breaker.protection !== null) {
    protection = breaker.protection;
    protectionSource = 'breaker';
  }

  // Reverse switch-control: which switches toggle this device.
  const controllerIds = new Set(
    switchControls
      .filter((sc) => sc.controlledId === component.id)
      .map((sc) => sc.switchId),
  );
  const controllingSwitches = allComponents.filter((c) =>
    controllerIds.has(c.id),
  );

  // Circuit-mates: other components wired to the same breaker.
  const circuitMates =
    breaker !== null
      ? allComponents.filter(
          (c) => c.breakerId === breaker.id && c.id !== component.id,
        )
      : [];

  // Feeder chain: walk UP via panel.parentBreakerId (depth-capped against a
  // corrupted-state cycle, mirroring computeCascadeOff).
  const feederChain: FeederLink[] = [];
  if (panel !== null) {
    let cur: Panel | null = panel;
    const depthCap = allPanels.length + 1;
    let depth = 0;
    while (cur !== null && cur.parentBreakerId !== null && depth <= depthCap) {
      const parentBreakerId: string = cur.parentBreakerId;
      const fb: Breaker | null = breakerById.get(parentBreakerId) ?? null;
      if (fb === null) break;
      const fp: Panel | null = panelById.get(fb.panelId) ?? null;
      if (fp === null) break;
      feederChain.push({ feederBreaker: fb, feederPanel: fp, subPanel: cur });
      cur = fp;
      depth += 1;
    }
  }

  // Circuit load (include the device itself).
  const load =
    breaker !== null
      ? computeBreakerLoad(breaker, [...circuitMates, component])
      : null;

  const steps = buildSteps({
    breaker,
    panel,
    protection,
    controllingSwitches,
    circuitMates,
    feederChain,
    load,
  });

  return {
    component,
    breaker,
    panel,
    protection,
    protectionSource,
    controllingSwitches,
    circuitMates,
    feederChain,
    load,
    steps,
  };
};

type StepContext = {
  breaker: Breaker | null;
  panel: Panel | null;
  protection: ProtectionKind | null;
  controllingSwitches: Component[];
  circuitMates: Component[];
  feederChain: FeederLink[];
  load: BreakerLoad | null;
};

const buildSteps = (d: StepContext): TroubleshootStep[] => {
  const steps: TroubleshootStep[] = [];

  // Unwired — there's no circuit to trace.
  if (d.breaker === null || d.panel === null) {
    steps.push({
      kind: 'unwired',
      title: 'This device isn’t wired to a breaker yet',
      detail:
        'Wire it to its breaker (from the Library or on the floor map) so its circuit can be traced. Until then, check the device itself and the outlet it plugs into.',
    });
    return steps;
  }

  const breaker = d.breaker;
  const panel = d.panel;

  // Safety FIRST — before resetting anything, rule out a real fault. Both Eaton
  // and Family Handyman flag burning smells / scorch marks / warm or
  // discolored devices as a STOP-and-call-a-pro condition: repeatedly resetting
  // a breaker that is tripping on an arc fault or short is dangerous.
  steps.push({
    kind: 'safety',
    title: 'First, check for danger signs',
    detail:
      'Before resetting anything, look and sniff: a burning smell, scorch marks, a warm or discolored outlet/switch, or buzzing. If you find any, STOP — do not keep resetting the breaker. Turn it off and call a licensed electrician.',
  });

  // GFCI / dual — the most common cause of a dead receptacle, easiest fix.
  if (d.protection === 'gfci' || d.protection === 'dual') {
    steps.push({
      kind: 'gfci',
      title: 'Check the GFCI — press Reset',
      detail:
        'This circuit is GFCI-protected. Find the outlet with “Test / Reset” buttons (often in a bathroom, kitchen, garage, or outdoors) and press Reset — one tripped GFCI can kill several outlets downstream of it.',
    });
  }

  // AFCI / dual — resets at the breaker, not at an outlet.
  if (d.protection === 'afci' || d.protection === 'dual') {
    steps.push({
      kind: 'afci',
      title: 'Reset the AFCI breaker',
      detail:
        'This circuit is AFCI-protected. An AFCI trips on arc faults and resets at the breaker, not at a receptacle — push the breaker fully OFF, then ON.',
      href: breakerHref(panel.id, breaker.id),
    });
  }

  // Switched — make sure the controlling switch is on.
  if (d.controllingSwitches.length > 0) {
    const names = d.controllingSwitches.map((s) => s.name).join(', ');
    const multi = d.controllingSwitches.length > 1;
    steps.push({
      kind: 'switch',
      title: multi ? 'Check its switches (3-way)' : 'Make sure its switch is on',
      detail: multi
        ? `This is controlled by ${d.controllingSwitches.length} switches (${names}). With 3-way switches either one can leave it off — try toggling each.`
        : `This is controlled by the switch “${names}”. Make sure it’s on; for a 3-way, try the other position.`,
    });
  }

  // The breaker itself.
  steps.push({
    kind: 'breaker',
    title: `Check breaker: ${breakerName(breaker)}`,
    detail: `Open ${panel.name} → ${slotLabel(breaker)}. If the handle is tripped (stuck in the middle) or off, push it fully OFF, then back ON.`,
    href: breakerHref(panel.id, breaker.id),
  });

  // Upstream subpanel feeders.
  for (const link of d.feederChain) {
    steps.push({
      kind: 'feeder',
      title: `Check the feeder for ${link.subPanel.name}`,
      detail: `${link.subPanel.name} is fed from ${link.feederPanel.name} → ${breakerName(
        link.feederBreaker,
      )}. If the subpanel’s own breaker looks fine, check this upstream feeder.`,
      href: breakerHref(link.feederPanel.id, link.feederBreaker.id),
    });
  }

  // Overload — only when it's actually loaded.
  if (d.load !== null && (d.load.status === 'over' || d.load.status === 'warn')) {
    const pct = Math.round(d.load.pct * 100);
    steps.push({
      kind: 'overload',
      title:
        d.load.status === 'over'
          ? `Circuit is over capacity (${pct}%)`
          : `Circuit is heavily loaded (${pct}%)`,
      detail:
        'If the breaker trips again right after you reset it, the circuit is overloaded or has a fault. Unplug high-draw devices; if it keeps tripping, call an electrician.',
    });
  }

  // Local fault vs whole circuit.
  const mateCount = d.circuitMates.length;
  steps.push({
    kind: 'isolate',
    title: 'Local fault, or the whole circuit?',
    detail:
      mateCount === 0
        ? 'Nothing else is recorded on this circuit. If the breaker is on and this is still dead, the problem is local — the device, its outlet, or a loose connection.'
        : `${mateCount} other device${
            mateCount === 1 ? '' : 's'
          } share this circuit. If they’re ALSO dead, the breaker above is the culprit. If only this one is dead, it’s local — the device, its outlet, or a loose wire.`,
  });

  return steps;
};
