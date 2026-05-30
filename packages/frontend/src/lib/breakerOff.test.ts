import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Breaker, Panel } from '@he/shared';
import {
  computeOffState,
  groupBreakersByPanel,
  isBreakerOff,
  isComponentOff,
  offVia,
} from './breakerOff.js';

const mkPanel = (over: Partial<Panel> & { id: string }): Panel => ({
  name: `Panel ${over.id}`,
  orientation: 'vertical',
  slotCount: 24,
  parentBreakerId: null,
  floorPlan: null,
  createdAt: 0,
  ...over,
});

const mkBreaker = (
  over: Partial<Breaker> & { id: string; panelId: string }
): Breaker => ({
  slot: '1',
  slotPosition: 1,
  amperage: 20,
  poles: 'single',
  label: `Breaker ${over.id}`,
  tandemHalf: null,
  protection: null,
  isOn: true,
  createdAt: 0,
  ...over,
});

test('a directly-off breaker is off; on breakers are not', () => {
  const main = mkPanel({ id: 'main' });
  const b1 = mkBreaker({ id: 'b1', panelId: 'main', isOn: false });
  const b2 = mkBreaker({ id: 'b2', panelId: 'main', isOn: true });
  const groups = [{ panel: main, breakers: [b1, b2] }];
  const off = computeOffState([main], groupBreakersByPanel(groups));
  assert.equal(isBreakerOff(off, 'b1'), true);
  assert.equal(isBreakerOff(off, 'b2'), false);
  assert.equal(off.directOffIds.has('b1'), true);
  assert.equal(offVia(off, 'b1'), null); // direct → no "via"
});

test('an off feeder cascades to the subpanel it feeds', () => {
  const main = mkPanel({ id: 'main' });
  // feeder breaker on main, marked OFF, feeds subpanel "sub".
  const feeder = mkBreaker({ id: 'feeder', panelId: 'main', isOn: false });
  const sub = mkPanel({ id: 'sub', parentBreakerId: 'feeder' });
  const subBreaker = mkBreaker({ id: 'sb', panelId: 'sub', isOn: true });
  const groups = [
    { panel: main, breakers: [feeder] },
    { panel: sub, breakers: [subBreaker] },
  ];
  const off = computeOffState([main, sub], groupBreakersByPanel(groups));
  // The subpanel breaker is off via cascade even though its own isOn is true.
  assert.equal(isBreakerOff(off, 'sb'), true);
  assert.equal(off.cascadeOffIds.has('sb'), true);
  assert.equal(offVia(off, 'sb'), 'Panel sub');
});

test('isComponentOff follows the component breakerId', () => {
  const main = mkPanel({ id: 'main' });
  const b1 = mkBreaker({ id: 'b1', panelId: 'main', isOn: false });
  const off = computeOffState(
    [main],
    groupBreakersByPanel([{ panel: main, breakers: [b1] }])
  );
  assert.equal(isComponentOff(off, { breakerId: 'b1' }), true);
  assert.equal(isComponentOff(off, { breakerId: 'other' }), false);
  assert.equal(isComponentOff(off, { breakerId: null }), false);
});

test('all-on house yields an empty off-state', () => {
  const main = mkPanel({ id: 'main' });
  const b1 = mkBreaker({ id: 'b1', panelId: 'main' });
  const off = computeOffState(
    [main],
    groupBreakersByPanel([{ panel: main, breakers: [b1] }])
  );
  assert.equal(off.directOffIds.size, 0);
  assert.equal(off.cascadeOffIds.size, 0);
  assert.equal(isBreakerOff(off, 'b1'), false);
});
