import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Breaker,
  Panel,
  ResolvedBreakerSummary,
  ResolvedComponent,
} from '@he/shared';
import { computeImpact } from './impact.js';

const makePanel = (
  partial: Partial<Panel> & { id: string; name: string }
): Panel => ({
  id: partial.id,
  name: partial.name,
  createdAt: partial.createdAt ?? Date.now(),
  floorPlan: partial.floorPlan ?? null,
  orientation: partial.orientation ?? 'vertical',
  slotCount: partial.slotCount ?? 24,
  parentBreakerId: partial.parentBreakerId ?? null,
});

const makeBreaker = (
  partial: Partial<Breaker> & { id: string; panelId: string }
): Breaker => ({
  id: partial.id,
  panelId: partial.panelId,
  slot: partial.slot ?? '1',
  slotPosition: partial.slotPosition ?? 1,
  amperage: partial.amperage ?? 15,
  poles: partial.poles ?? 'single',
  label: partial.label ?? `Breaker ${partial.id}`,
  tandemHalf: partial.tandemHalf ?? null,
  protection: partial.protection ?? null,
  createdAt: partial.createdAt ?? Date.now(),
});

const makeComponent = (
  partial: Partial<ResolvedComponent> & { id: string; name: string }
): ResolvedComponent => {
  const breakerSummary: ResolvedBreakerSummary | null =
    partial.breaker ?? null;
  return {
    id: partial.id,
    type: partial.type ?? 'outlet',
    name: partial.name,
    room: partial.room ?? null,
    notes: partial.notes ?? null,
    critical: partial.critical ?? false,
    breakerId: partial.breakerId ?? null,
    floorId: partial.floorId ?? null,
    posX: partial.posX ?? null,
    posY: partial.posY ?? null,
    gangs: partial.gangs ?? 1,
    protection: partial.protection ?? null,
    createdAt: partial.createdAt ?? Date.now(),
    breaker: breakerSummary,
  };
};

test('computeImpact — direct hit only (no subpanel)', () => {
  const main = makePanel({ id: 'main', name: 'Main' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const b2 = makeBreaker({ id: 'b2', panelId: 'main' });
  const c1 = makeComponent({ id: 'c1', name: 'Kitchen Light', breakerId: 'b1' });
  const c2 = makeComponent({ id: 'c2', name: 'Bedroom Light', breakerId: 'b2' });
  const items = computeImpact(
    'b1',
    [c1, c2],
    [main],
    new Map([['main', [b1, b2]]])
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].component.id, 'c1');
  assert.equal(items[0].reason, 'direct');
  assert.equal(items[0].viaSubpanel, undefined);
});

test('computeImpact — cascade hit only (1-level via subpanel)', () => {
  // Main feeder b1 → Subpanel A. b1 itself controls nothing directly.
  // Flip b1 → A's components all lose power.
  const main = makePanel({ id: 'main', name: 'Main' });
  const subA = makePanel({
    id: 'a',
    name: 'Subpanel A',
    parentBreakerId: 'b1',
  });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const y2 = makeBreaker({ id: 'y2', panelId: 'a' });
  const cLight = makeComponent({
    id: 'cL',
    name: 'Sub Light',
    breakerId: 'y1',
  });
  const cOutlet = makeComponent({
    id: 'cO',
    name: 'Sub Outlet',
    breakerId: 'y2',
  });
  const items = computeImpact(
    'b1',
    [cLight, cOutlet],
    [main, subA],
    new Map([
      ['main', [b1]],
      ['a', [y1, y2]],
    ])
  );
  assert.equal(items.length, 2);
  for (const it of items) {
    assert.equal(it.reason, 'cascade');
    assert.equal(it.viaSubpanel, 'Subpanel A');
  }
  const names = items.map((it) => it.component.name).sort();
  assert.deepEqual(names, ['Sub Light', 'Sub Outlet']);
});

test('computeImpact — both direct AND cascade present (different components)', () => {
  // b1 is a feeder for Subpanel A AND controls c1 directly.
  // (Electrically unusual but the data model allows it: a breaker may
  // feed a subpanel AND have wired components — though the latter is
  // rare. Test confirms the helper handles both branches.)
  const main = makePanel({ id: 'main', name: 'Main' });
  const subA = makePanel({
    id: 'a',
    name: 'Subpanel A',
    parentBreakerId: 'b1',
  });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const direct = makeComponent({
    id: 'direct',
    name: 'Directly wired',
    breakerId: 'b1',
  });
  const cascade = makeComponent({
    id: 'cascade',
    name: 'Via subpanel',
    breakerId: 'y1',
  });
  const items = computeImpact(
    'b1',
    [direct, cascade],
    [main, subA],
    new Map([
      ['main', [b1]],
      ['a', [y1]],
    ])
  );
  assert.equal(items.length, 2);
  const directItem = items.find((it) => it.component.id === 'direct');
  const cascadeItem = items.find((it) => it.component.id === 'cascade');
  assert.ok(directItem);
  assert.equal(directItem.reason, 'direct');
  assert.equal(directItem.viaSubpanel, undefined);
  assert.ok(cascadeItem);
  assert.equal(cascadeItem.reason, 'cascade');
  assert.equal(cascadeItem.viaSubpanel, 'Subpanel A');
});

test('computeImpact — empty case (breaker controls nothing, no subpanel)', () => {
  const main = makePanel({ id: 'main', name: 'Main' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const b2 = makeBreaker({ id: 'b2', panelId: 'main' });
  const c1 = makeComponent({
    id: 'c1',
    name: 'Bedroom Light',
    breakerId: 'b2',
  });
  const items = computeImpact(
    'b1',
    [c1],
    [main],
    new Map([['main', [b1, b2]]])
  );
  assert.equal(items.length, 0);
});

test('computeImpact — 2-level cascade through sub-subpanel', () => {
  // Main b1 → Subpanel A (parent = b1). A.y2 → Subpanel B (parent = y2).
  // Flip b1: A's components AND B's components all lose power.
  const main = makePanel({ id: 'main', name: 'Main' });
  const subA = makePanel({
    id: 'a',
    name: 'Subpanel A',
    parentBreakerId: 'b1',
  });
  const subB = makePanel({
    id: 'b',
    name: 'Subpanel B',
    parentBreakerId: 'y2',
  });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const y2 = makeBreaker({ id: 'y2', panelId: 'a' });
  const z1 = makeBreaker({ id: 'z1', panelId: 'b' });
  const cA1 = makeComponent({
    id: 'cA1',
    name: 'In Subpanel A',
    breakerId: 'y1',
  });
  const cB1 = makeComponent({
    id: 'cB1',
    name: 'In Subpanel B',
    breakerId: 'z1',
  });
  const items = computeImpact(
    'b1',
    [cA1, cB1],
    [main, subA, subB],
    new Map([
      ['main', [b1]],
      ['a', [y1, y2]],
      ['b', [z1]],
    ])
  );
  assert.equal(items.length, 2);
  const aItem = items.find((it) => it.component.id === 'cA1');
  const bItem = items.find((it) => it.component.id === 'cB1');
  assert.ok(aItem);
  assert.equal(aItem.reason, 'cascade');
  assert.equal(aItem.viaSubpanel, 'Subpanel A');
  assert.ok(bItem);
  assert.equal(bItem.reason, 'cascade');
  assert.equal(bItem.viaSubpanel, 'Subpanel B');
});

test('computeImpact — does NOT add a switch_controls transitive leg', () => {
  // A switch is on b1. The switch (electrically) controls a light wired
  // to b2. Flipping b1 should NOT report the light as "loses power" —
  // the light has its own circuit (b2). Only the switch component
  // (directly on b1) shows up.
  const main = makePanel({ id: 'main', name: 'Main' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main', label: 'Switch row' });
  const b2 = makeBreaker({ id: 'b2', panelId: 'main', label: 'Light row' });
  const sw = makeComponent({
    id: 'sw',
    name: 'Living Switch',
    type: 'switch',
    breakerId: 'b1',
  });
  const light = makeComponent({
    id: 'light',
    name: 'Living Light',
    type: 'light',
    breakerId: 'b2',
  });
  const items = computeImpact(
    'b1',
    [sw, light],
    [main],
    new Map([['main', [b1, b2]]])
  );
  // Only the switch itself loses power; the light does NOT.
  assert.equal(items.length, 1);
  assert.equal(items[0].component.id, 'sw');
  assert.equal(items[0].reason, 'direct');
});
