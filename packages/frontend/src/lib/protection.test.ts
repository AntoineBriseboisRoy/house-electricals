import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUntestedProtected } from './protection.js';
import type { Breaker } from '@he/shared';

const mkBreaker = (over: Partial<Breaker> = {}): Breaker => ({
  id: 'b1',
  panelId: 'p1',
  slot: '1',
  slotPosition: 1,
  label: 'Test',
  amperage: 20,
  poles: 'single',
  tandemHalf: null,
  protection: 'gfci',
  createdAt: 0,
  ...over,
});

// A fixed "start of month" anchor for deterministic tests.
const MONTH_START = new Date(2026, 4, 1).getTime(); // 2026-05-01 local

test('never-tested (null) breaker counts as untested', () => {
  const b = mkBreaker({ id: 'b1' });
  const map = new Map<string, number | null>([['b1', null]]);
  const out = filterUntestedProtected([b], map, MONTH_START);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'b1');
});

test('Map miss (load in flight) counts as untested', () => {
  const b = mkBreaker({ id: 'b1' });
  const map = new Map<string, number | null>(); // no entry
  const out = filterUntestedProtected([b], map, MONTH_START);
  assert.equal(out.length, 1);
});

test('tested BEFORE monthStart counts as untested', () => {
  const b = mkBreaker({ id: 'b1' });
  const before = new Date(2026, 3, 15).getTime(); // 2026-04-15 (last month)
  const map = new Map<string, number | null>([['b1', before]]);
  const out = filterUntestedProtected([b], map, MONTH_START);
  assert.equal(out.length, 1);
});

test('tested THIS month is NOT untested', () => {
  const b = mkBreaker({ id: 'b1' });
  const thisMonth = new Date(2026, 4, 10).getTime(); // 2026-05-10
  const map = new Map<string, number | null>([['b1', thisMonth]]);
  const out = filterUntestedProtected([b], map, MONTH_START);
  assert.equal(out.length, 0);
});

test('tested exactly AT monthStart is NOT untested (strict <)', () => {
  const b = mkBreaker({ id: 'b1' });
  const map = new Map<string, number | null>([['b1', MONTH_START]]);
  const out = filterUntestedProtected([b], map, MONTH_START);
  assert.equal(out.length, 0);
});

test('mixed set: only untested breakers surface', () => {
  const b1 = mkBreaker({ id: 'b1' }); // never tested → untested
  const b2 = mkBreaker({ id: 'b2', protection: 'afci' }); // tested this month
  const b3 = mkBreaker({ id: 'b3', protection: 'dual' }); // tested last month
  const map = new Map<string, number | null>([
    ['b1', null],
    ['b2', new Date(2026, 4, 5).getTime()],
    ['b3', new Date(2026, 2, 1).getTime()],
  ]);
  const out = filterUntestedProtected([b1, b2, b3], map, MONTH_START);
  assert.deepEqual(
    out.map((b) => b.id).sort(),
    ['b1', 'b3']
  );
});

test('empty protected set returns empty', () => {
  const out = filterUntestedProtected([], new Map(), MONTH_START);
  assert.equal(out.length, 0);
});
