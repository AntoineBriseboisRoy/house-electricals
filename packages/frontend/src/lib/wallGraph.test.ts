import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Wall } from '@he/shared';
import {
  findLoopThrough,
  loopMatchesAnyRoom,
  roomBoundaryWallIds,
  sameVertexSet,
} from './wallGraph.js';

let seq = 0;
const wall = (x1: number, y1: number, x2: number, y2: number, id?: string): Wall => ({
  id: id ?? `w${seq++}`,
  floorId: 'f1',
  x1,
  y1,
  x2,
  y2,
  createdAt: 0,
});

test('findLoopThrough — 4 walls forming a square return the 4 corner vertices', () => {
  // Square 0,0 → 1000,0 → 1000,1000 → 0,1000 → back to 0,0 (closing wall).
  const walls = [
    wall(0, 0, 1000, 0, 'a'),
    wall(1000, 0, 1000, 1000, 'b'),
    wall(1000, 1000, 0, 1000, 'c'),
    wall(0, 1000, 0, 0, 'd'), // closes the loop
  ];
  const loop = findLoopThrough(walls, 'd');
  assert.notEqual(loop, null);
  assert.equal(loop?.length, 4);
  // The four corners are present (order/rotation may vary).
  assert.ok(sameVertexSet(loop as { x: number; y: number }[], [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ]));
});

test('findLoopThrough — open chain of walls returns null', () => {
  const walls = [
    wall(0, 0, 1000, 0, 'a'),
    wall(1000, 0, 1000, 1000, 'b'),
    wall(1000, 1000, 0, 1000, 'c'), // never returns to 0,0
  ];
  assert.equal(findLoopThrough(walls, 'c'), null);
});

test('findLoopThrough — a lone wall closes nothing', () => {
  const walls = [wall(0, 0, 1000, 0, 'a')];
  assert.equal(findLoopThrough(walls, 'a'), null);
});

test('findLoopThrough — triangle returns 3 vertices', () => {
  const walls = [
    wall(0, 0, 1000, 0, 'a'),
    wall(1000, 0, 500, 800, 'b'),
    wall(500, 800, 0, 0, 'c'), // closes
  ];
  const loop = findLoopThrough(walls, 'c');
  assert.equal(loop?.length, 3);
});

test('findLoopThrough — two walls between the same pair is not a room', () => {
  // Degenerate: only 2 vertices in the "cycle" → reject.
  const walls = [wall(0, 0, 1000, 0, 'a'), wall(1000, 0, 0, 0, 'b')];
  assert.equal(findLoopThrough(walls, 'b'), null);
});

test('findLoopThrough — finds the MINIMAL enclosing loop', () => {
  // A 2x1 grid of squares sharing the middle wall. Closing the shared middle
  // wall should give the tighter (4-vertex) square, not the 6-vertex outer.
  const walls = [
    wall(0, 0, 1000, 0, 'top-l'),
    wall(1000, 0, 2000, 0, 'top-r'),
    wall(0, 0, 0, 1000, 'left'),
    wall(1000, 0, 1000, 1000, 'mid'), // the closing wall
    wall(2000, 0, 2000, 1000, 'right'),
    wall(0, 1000, 1000, 1000, 'bot-l'),
    wall(1000, 1000, 2000, 1000, 'bot-r'),
  ];
  const loop = findLoopThrough(walls, 'mid');
  assert.equal(loop?.length, 4); // a unit square, not the 6-vertex outer rectangle
});

test('loopMatchesAnyRoom — matches a room with the same vertex set', () => {
  const loop = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ];
  const rooms = [
    {
      points: [
        { x: 0, y: 1000 },
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
    },
  ];
  assert.equal(loopMatchesAnyRoom(loop, rooms), true);
  assert.equal(loopMatchesAnyRoom(loop, [{ points: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }] }]), false);
});

test('roomBoundaryWallIds — flags walls coinciding with a room edge', () => {
  const room = {
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ],
  };
  const walls = [
    wall(0, 0, 1000, 0, 'top'), // room edge
    wall(1000, 1000, 0, 1000, 'bottom-reversed'), // room edge, reversed order
    wall(5000, 5000, 6000, 5000, 'free'), // standalone
  ];
  const ids = roomBoundaryWallIds(walls, [room]);
  assert.equal(ids.has('top'), true);
  assert.equal(ids.has('bottom-reversed'), true); // direction-independent
  assert.equal(ids.has('free'), false);
});

test('roomBoundaryWallIds — empty when there are no rooms', () => {
  assert.equal(roomBoundaryWallIds([wall(0, 0, 1000, 0, 'a')], []).size, 0);
});
