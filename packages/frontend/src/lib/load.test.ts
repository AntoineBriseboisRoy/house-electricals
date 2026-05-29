import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakerCapacityWatts,
  breakerVolts,
  computeBreakerLoad,
  loadStatus,
  sumLoadWatts,
} from './load.js';

test('breakerVolts: single/tandem = 120, double = 240', () => {
  assert.equal(breakerVolts({ poles: 'single' }), 120);
  assert.equal(breakerVolts({ poles: 'tandem' }), 120);
  assert.equal(breakerVolts({ poles: 'double' }), 240);
});

test('breakerCapacityWatts: amperage × volts × 0.8', () => {
  // 15A single → 15 * 120 * 0.8 = 1440
  assert.equal(breakerCapacityWatts({ poles: 'single', amperage: 15 }), 1440);
  // 20A single → 20 * 120 * 0.8 = 1920
  assert.equal(breakerCapacityWatts({ poles: 'single', amperage: 20 }), 1920);
  // 30A double → 30 * 240 * 0.8 = 5760
  assert.equal(breakerCapacityWatts({ poles: 'double', amperage: 30 }), 5760);
});

test('sumLoadWatts: nulls count as 0', () => {
  assert.equal(
    sumLoadWatts([{ loadWatts: 100 }, { loadWatts: null }, { loadWatts: 250 }]),
    350
  );
  assert.equal(sumLoadWatts([]), 0);
});

test('loadStatus: ok ≤ 80%, warn > 80%, over > 100%', () => {
  assert.equal(loadStatus(0, 1000), 'ok');
  assert.equal(loadStatus(800, 1000), 'ok'); // exactly 80% → ok
  assert.equal(loadStatus(801, 1000), 'warn');
  assert.equal(loadStatus(1000, 1000), 'warn'); // exactly 100% → still warn
  assert.equal(loadStatus(1001, 1000), 'over');
  assert.equal(loadStatus(500, 0), 'ok'); // zero capacity never flags
});

test('computeBreakerLoad: end-to-end on a 15A single', () => {
  const r = computeBreakerLoad({ poles: 'single', amperage: 15 }, [
    { loadWatts: 1500 },
    { loadWatts: null },
  ]);
  assert.equal(r.watts, 1500);
  assert.equal(r.capacity, 1440);
  assert.equal(r.status, 'over'); // 1500 > 1440
  assert.ok(r.pct > 1);
});
