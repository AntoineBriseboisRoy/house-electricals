import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '@he/shared';
import { findRoomForPoint, findPointsInRect } from './roomLookup.js';

const makeRoom = (
  partial: Partial<Room> & { name: string; x: number; y: number; w: number; h: number }
): Room => ({
  id: partial.id ?? `r-${partial.name}`,
  floorId: partial.floorId ?? 'floor-1',
  name: partial.name,
  x: partial.x,
  y: partial.y,
  w: partial.w,
  h: partial.h,
  createdAt: partial.createdAt ?? Date.now(),
});

test('findRoomForPoint — point clearly inside one room returns that room', () => {
  const rooms = [makeRoom({ name: 'Kitchen', x: 1000, y: 1000, w: 2000, h: 2000 })];
  const hit = findRoomForPoint(rooms, 1500, 2000);
  assert.equal(hit?.name, 'Kitchen');
});

test('findRoomForPoint — overlapping rooms return first match', () => {
  const rooms = [
    makeRoom({ name: 'Outer', x: 0, y: 0, w: 5000, h: 5000 }),
    makeRoom({ name: 'Inner', x: 1000, y: 1000, w: 1000, h: 1000 }),
  ];
  const hit = findRoomForPoint(rooms, 1500, 1500);
  assert.equal(hit?.name, 'Outer');
});

test('findRoomForPoint — point outside all rooms returns null', () => {
  const rooms = [makeRoom({ name: 'Kitchen', x: 1000, y: 1000, w: 2000, h: 2000 })];
  const hit = findRoomForPoint(rooms, 500, 500);
  assert.equal(hit, null);
});

test('findRoomForPoint — boundary is inclusive on both axes', () => {
  const rooms = [makeRoom({ name: 'Kitchen', x: 1000, y: 1000, w: 2000, h: 2000 })];
  // exactly on the left edge
  assert.equal(findRoomForPoint(rooms, 1000, 2000)?.name, 'Kitchen');
  // exactly on the bottom-right corner
  assert.equal(findRoomForPoint(rooms, 3000, 3000)?.name, 'Kitchen');
  // 1 unit outside
  assert.equal(findRoomForPoint(rooms, 3001, 3000), null);
});

test('findRoomForPoint — empty rooms array returns null', () => {
  assert.equal(findRoomForPoint([], 1000, 1000), null);
});

test('findPointsInRect — filters items by inclusive point-in-rect', () => {
  const items = [
    { id: 'a', posX: 1500, posY: 1500 }, // inside
    { id: 'b', posX: 4000, posY: 4000 }, // outside
    { id: 'c', posX: 1000, posY: 2000 }, // on edge — inside
    { id: 'd', posX: null, posY: null }, // unplaced — excluded
  ];
  const got = findPointsInRect(items, { x: 1000, y: 1000, w: 2000, h: 2000 });
  assert.deepEqual(
    got.map((i) => i.id),
    ['a', 'c']
  );
});
