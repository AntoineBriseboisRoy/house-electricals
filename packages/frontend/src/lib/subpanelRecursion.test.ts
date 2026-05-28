import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Breaker, Panel } from '@he/shared';
import { computeCascadeOff } from './subpanelRecursion.js';

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

test('computeCascadeOff — empty offBreakerIds returns empty cascade', () => {
  const main = makePanel({ id: 'main', name: 'Main' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const result = computeCascadeOff(
    new Set(),
    [main],
    new Map([['main', [b1]]])
  );
  assert.equal(result.cascadeBreakerIds.size, 0);
  assert.equal(result.attribution.size, 0);
});

test('computeCascadeOff — direct off with no subpanels returns empty cascade', () => {
  const main = makePanel({ id: 'main', name: 'Main' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const b2 = makeBreaker({ id: 'b2', panelId: 'main' });
  const result = computeCascadeOff(
    new Set(['b1']),
    [main],
    new Map([['main', [b1, b2]]])
  );
  // b1 is direct-off only — no subpanel hangs off it, no cascade.
  assert.equal(result.cascadeBreakerIds.size, 0);
  assert.equal(result.attribution.size, 0);
});

test('computeCascadeOff — 1-level cascade: feeder off → subpanel breakers cascade', () => {
  // Main panel feeds Subpanel A via main.b1. A has y1, y2, y3.
  const main = makePanel({ id: 'main', name: 'Main' });
  const a = makePanel({ id: 'a', name: 'Subpanel A', parentBreakerId: 'b1' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const b2 = makeBreaker({ id: 'b2', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const y2 = makeBreaker({ id: 'y2', panelId: 'a' });
  const y3 = makeBreaker({ id: 'y3', panelId: 'a' });
  const result = computeCascadeOff(
    new Set(['b1']),
    [main, a],
    new Map([
      ['main', [b1, b2]],
      ['a', [y1, y2, y3]],
    ])
  );
  assert.equal(result.cascadeBreakerIds.size, 3);
  assert.ok(result.cascadeBreakerIds.has('y1'));
  assert.ok(result.cascadeBreakerIds.has('y2'));
  assert.ok(result.cascadeBreakerIds.has('y3'));
  // b1 itself is direct-off, NOT in cascade.
  assert.ok(!result.cascadeBreakerIds.has('b1'));
  // b2 is on main but main isn't off — NOT in cascade.
  assert.ok(!result.cascadeBreakerIds.has('b2'));
  // Attribution: all three point to "Subpanel A".
  assert.equal(result.attribution.get('y1'), 'Subpanel A');
  assert.equal(result.attribution.get('y2'), 'Subpanel A');
  assert.equal(result.attribution.get('y3'), 'Subpanel A');
});

test('computeCascadeOff — 2-level cascade: deep feeder cascades through sub-subpanel', () => {
  // Main → A (via main.b1) → B (via a.y2).
  // Flip main.b1: BOTH A's breakers AND B's breakers cascade-off.
  const main = makePanel({ id: 'main', name: 'Main' });
  const a = makePanel({ id: 'a', name: 'Subpanel A', parentBreakerId: 'b1' });
  const b = makePanel({ id: 'b', name: 'Subpanel B', parentBreakerId: 'y2' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const y2 = makeBreaker({ id: 'y2', panelId: 'a' });
  const z1 = makeBreaker({ id: 'z1', panelId: 'b' });
  const z2 = makeBreaker({ id: 'z2', panelId: 'b' });
  const result = computeCascadeOff(
    new Set(['b1']),
    [main, a, b],
    new Map([
      ['main', [b1]],
      ['a', [y1, y2]],
      ['b', [z1, z2]],
    ])
  );
  // y1, y2 cascade via Subpanel A; z1, z2 cascade via Subpanel B.
  assert.equal(result.cascadeBreakerIds.size, 4);
  assert.equal(result.attribution.get('y1'), 'Subpanel A');
  assert.equal(result.attribution.get('y2'), 'Subpanel A');
  assert.equal(result.attribution.get('z1'), 'Subpanel B');
  assert.equal(result.attribution.get('z2'), 'Subpanel B');
});

test('computeCascadeOff — direct-off wins over cascade-off', () => {
  // Main → A (via main.b1). Flip BOTH main.b1 AND a.y2.
  // Expectation: y1 cascade-off (via Subpanel A); y2 NOT in cascade
  // set (it's already direct-off).
  const main = makePanel({ id: 'main', name: 'Main' });
  const a = makePanel({ id: 'a', name: 'Subpanel A', parentBreakerId: 'b1' });
  const b1 = makeBreaker({ id: 'b1', panelId: 'main' });
  const y1 = makeBreaker({ id: 'y1', panelId: 'a' });
  const y2 = makeBreaker({ id: 'y2', panelId: 'a' });
  const result = computeCascadeOff(
    new Set(['b1', 'y2']),
    [main, a],
    new Map([
      ['main', [b1]],
      ['a', [y1, y2]],
    ])
  );
  assert.equal(result.cascadeBreakerIds.size, 1);
  assert.ok(result.cascadeBreakerIds.has('y1'));
  assert.ok(!result.cascadeBreakerIds.has('y2'));
  assert.equal(result.attribution.get('y1'), 'Subpanel A');
  assert.equal(result.attribution.has('y2'), false);
});

test('computeCascadeOff — cycle safety: pathological A→B→A loop does not infinite-loop', () => {
  // Pathological state (cycle-56 validation would reject, but DB
  // could be corrupted): A's parent is B's breaker; B's parent is
  // A's breaker. Flip a third unrelated breaker. Walker must
  // terminate.
  const root = makePanel({ id: 'root', name: 'Root' });
  const a = makePanel({ id: 'a', name: 'A', parentBreakerId: 'b-breaker' });
  const b = makePanel({ id: 'b', name: 'B', parentBreakerId: 'a-breaker' });
  const rootBreaker = makeBreaker({ id: 'rbk', panelId: 'root' });
  const aBreaker = makeBreaker({ id: 'a-breaker', panelId: 'a' });
  const bBreaker = makeBreaker({ id: 'b-breaker', panelId: 'b' });

  // Flip the root breaker. Neither A nor B should cascade (their
  // feeder chains go in a circle, never touching the root breaker).
  // Most importantly, the walker MUST terminate.
  const result = computeCascadeOff(
    new Set(['rbk']),
    [root, a, b],
    new Map([
      ['root', [rootBreaker]],
      ['a', [aBreaker]],
      ['b', [bBreaker]],
    ])
  );
  // The cycle has no off-feeder in it, so nothing cascades.
  assert.equal(result.cascadeBreakerIds.size, 0);
});

test('computeCascadeOff — cycle safety: flipping a breaker INSIDE the cycle does not infinite-loop', () => {
  // Same A↔B cycle. Flip aBreaker (which IS the feeder for B in the
  // pathological state). B's breakers should cascade (one-level walk
  // is fine); the BFS must NOT infinite-loop trying to walk A→B→A
  // again.
  const root = makePanel({ id: 'root', name: 'Root' });
  const a = makePanel({ id: 'a', name: 'A', parentBreakerId: 'b-breaker' });
  const b = makePanel({ id: 'b', name: 'B', parentBreakerId: 'a-breaker' });
  const aBreaker = makeBreaker({ id: 'a-breaker', panelId: 'a' });
  const bBreaker = makeBreaker({ id: 'b-breaker', panelId: 'b' });

  const result = computeCascadeOff(
    new Set(['a-breaker']),
    [root, a, b],
    new Map([
      ['root', []],
      ['a', [aBreaker]],
      ['b', [bBreaker]],
    ])
  );
  // B is fed by aBreaker which is off → bBreaker cascades.
  // A is fed by bBreaker which is in cascade, NOT direct-off — but
  // the BFS DOES expand here (panel B is in frontier; panel A's
  // parent breaker is owned by panel B), so aBreaker would ALSO be
  // in the cascade set... EXCEPT aBreaker is in offBreakerIds, so
  // direct-off precedence excludes it.
  // Walker must terminate either way.
  assert.ok(result.cascadeBreakerIds.has('b-breaker'));
  assert.ok(!result.cascadeBreakerIds.has('a-breaker')); // direct-off wins
});
