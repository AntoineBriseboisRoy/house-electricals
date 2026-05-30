import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Breaker, Component, Panel, SwitchControl } from '@he/shared';
import { diagnose, type TroubleshootInput } from './troubleshoot.js';

// ── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
const id = (p: string): string => `${p}-${(seq += 1)}`;

const comp = (over: Partial<Component> = {}): Component => ({
  id: id('c'),
  type: 'outlet',
  name: 'Outlet',
  room: null,
  notes: null,
  critical: false,
  breakerId: null,
  floorId: null,
  posX: null,
  posY: null,
  gangs: 1,
  loadWatts: null,
  protection: null,
  createdAt: 0,
  ...over,
});

const brk = (over: Partial<Breaker> = {}): Breaker => ({
  id: id('b'),
  panelId: 'p-main',
  slot: '1',
  slotPosition: 1,
  amperage: 15,
  poles: 'single',
  label: '',
  tandemHalf: null,
  protection: null,
  createdAt: 0,
  ...over,
});

const panel = (over: Partial<Panel> = {}): Panel => ({
  id: id('p'),
  name: 'Main Panel',
  createdAt: 0,
  floorPlan: null,
  orientation: 'vertical',
  slotCount: 24,
  parentBreakerId: null,
  ...over,
});

const sc = (switchId: string, controlledId: string): SwitchControl => ({
  switchId,
  gangIndex: 0,
  controlledId,
});

const build = (
  component: Component,
  panels: Panel[],
  breakers: Breaker[],
  switchControls: SwitchControl[] = [],
  allComponents: Component[] = [component],
): TroubleshootInput => {
  const breakersByPanel = new Map<string, Breaker[]>();
  for (const p of panels) {
    breakersByPanel.set(
      p.id,
      breakers.filter((b) => b.panelId === p.id),
    );
  }
  return {
    component,
    allComponents,
    allPanels: panels,
    breakersByPanel,
    switchControls,
  };
};

const kinds = (d: ReturnType<typeof diagnose>): string[] =>
  d.steps.map((s) => s.kind);

const lastKind = (d: ReturnType<typeof diagnose>): string =>
  d.steps[d.steps.length - 1]?.kind ?? '';

const indexOf = (d: ReturnType<typeof diagnose>, k: string): number =>
  kinds(d).indexOf(k);

// ── tests ───────────────────────────────────────────────────────────────────

test('unwired device → a single unwired step, no breaker/panel', () => {
  const c = comp({ breakerId: null });
  const p = panel({ id: 'p-main' });
  const d = diagnose(build(c, [p], []));
  assert.equal(d.breaker, null);
  assert.equal(d.panel, null);
  assert.deepEqual(kinds(d), ['unwired']);
});

test('wired device → safety is always the FIRST step', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main' });
  const c = comp({ breakerId: 'b-1' });
  const d = diagnose(build(c, [p], [b]));
  assert.equal(kinds(d)[0], 'safety');
});

test('GFCI breaker → safety, then gfci, then breaker, ending in isolate', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main', protection: 'gfci', label: 'Kitchen' });
  const c = comp({ breakerId: 'b-1', name: 'Kitchen Outlet' });
  const d = diagnose(build(c, [p], [b]));
  assert.equal(d.protection, 'gfci');
  assert.equal(d.protectionSource, 'breaker');
  assert.equal(kinds(d)[0], 'safety');
  // canonical order: gfci is checked before the breaker.
  assert.ok(indexOf(d, 'gfci') < indexOf(d, 'breaker'));
  assert.equal(lastKind(d), 'isolate');
  const breakerStep = d.steps.find((s) => s.kind === 'breaker');
  assert.equal(breakerStep?.href, '/panels/p-main#breaker-b-1');
});

test('component-level protection wins over the breaker protection', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main', protection: null });
  const c = comp({ breakerId: 'b-1', protection: 'dual' });
  const d = diagnose(build(c, [p], [b]));
  assert.equal(d.protection, 'dual');
  assert.equal(d.protectionSource, 'component');
  assert.ok(kinds(d).includes('gfci'));
  assert.ok(kinds(d).includes('afci'));
});

test('switched light → switch step names the controlling switch', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main' });
  const light = comp({ id: 'c-light', type: 'light', name: 'Hall Light', breakerId: 'b-1' });
  const sw = comp({ id: 'c-sw', type: 'switch', name: 'Hall Switch', breakerId: 'b-1' });
  const d = diagnose(
    build(light, [p], [b], [sc('c-sw', 'c-light')], [light, sw]),
  );
  assert.equal(d.controllingSwitches.length, 1);
  const swStep = d.steps.find((s) => s.kind === 'switch');
  assert.ok(swStep, 'expected a switch step');
  assert.ok(swStep.detail.includes('Hall Switch'));
});

test('subpanel device → a feeder step points upstream', () => {
  const main = panel({ id: 'p-main', name: 'Main' });
  const feeder = brk({ id: 'b-feeder', panelId: 'p-main', label: 'Sub feed' });
  const sub = panel({ id: 'p-sub', name: 'Garage Sub', parentBreakerId: 'b-feeder' });
  const subBrk = brk({ id: 'b-sub1', panelId: 'p-sub', label: 'Bench' });
  const c = comp({ breakerId: 'b-sub1', name: 'Bench Outlet' });
  const d = diagnose(build(c, [main, sub], [feeder, subBrk]));
  assert.equal(d.feederChain.length, 1);
  assert.equal(d.feederChain[0]?.feederBreaker.id, 'b-feeder');
  const feederStep = d.steps.find((s) => s.kind === 'feeder');
  assert.ok(feederStep, 'expected a feeder step');
  assert.equal(feederStep.href, '/panels/p-main#breaker-b-feeder');
});

test('circuit-mates → isolate step reports the count and excludes self', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main' });
  const target = comp({ id: 'c-target', breakerId: 'b-1', name: 'Target' });
  const mate1 = comp({ id: 'c-m1', breakerId: 'b-1', name: 'Mate 1' });
  const mate2 = comp({ id: 'c-m2', breakerId: 'b-1', name: 'Mate 2' });
  const d = diagnose(build(target, [p], [b], [], [target, mate1, mate2]));
  assert.equal(d.circuitMates.length, 2);
  assert.ok(!d.circuitMates.some((c) => c.id === 'c-target'));
  const iso = d.steps.find((s) => s.kind === 'isolate');
  assert.ok(iso?.detail.includes('2 other devices'));
});

test('overloaded circuit → an overload step appears', () => {
  const p = panel({ id: 'p-main' });
  const b = brk({ id: 'b-1', panelId: 'p-main', amperage: 15, poles: 'single' });
  // 15A single-pole capacity = 15*120*0.8 = 1440W; a 2000W load is over.
  const c = comp({ breakerId: 'b-1', loadWatts: 2000 });
  const d = diagnose(build(c, [p], [b]));
  assert.equal(d.load?.status, 'over');
  assert.ok(kinds(d).includes('overload'));
});
