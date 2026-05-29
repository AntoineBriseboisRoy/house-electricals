import type { RoomVertex, Wall } from '@he/shared';

/**
 * Wall graph + closed-loop detection (vector floor editor).
 *
 * A "vertex" is a coordinate. Wall endpoints that share a coordinate (they
 * snapped together — see lib/snap.snapWithVertices) are the SAME graph vertex,
 * so converging walls are linked implicitly through coincident coords (no
 * vertex table). When a freshly drawn / dragged wall closes a cycle, that
 * cycle's ordered vertices become a polygon room.
 *
 * Everything here is pure + side-effect-free so it's trivially testable.
 */

export type Pt = { x: number; y: number };

/** Stable key for a coordinate. Endpoints snap to exact integers, so an
 *  equality key (no rounding) is correct + collision-free. */
const keyOf = (p: Pt): string => `${p.x}:${p.y}`;

type Adjacency = Map<string, { to: string; wallId: string }[]>;

type WallGraph = {
  adj: Adjacency;
  /** key → its coordinate (for reconstructing a polygon from keys). */
  coord: Map<string, Pt>;
};

const buildGraph = (walls: ReadonlyArray<Wall>): WallGraph => {
  const adj: Adjacency = new Map();
  const coord = new Map<string, Pt>();
  const ensure = (p: Pt): string => {
    const k = keyOf(p);
    if (!coord.has(k)) coord.set(k, { x: p.x, y: p.y });
    if (!adj.has(k)) adj.set(k, []);
    return k;
  };
  for (const w of walls) {
    const ka = ensure({ x: w.x1, y: w.y1 });
    const kb = ensure({ x: w.x2, y: w.y2 });
    if (ka === kb) continue; // zero-length wall — ignore
    adj.get(ka)?.push({ to: kb, wallId: w.id });
    adj.get(kb)?.push({ to: ka, wallId: w.id });
  }
  return { adj, coord };
};

/**
 * Find the SMALLEST simple cycle that uses wall `wallId`, returned as ordered
 * polygon vertices (the closing edge — `wallId` — is implied between the last
 * and first vertex; the first vertex is NOT repeated). Returns null when the
 * wall closes no loop, or the only loop is degenerate (< 3 vertices).
 *
 * Method: the wall connects vertices A and B. BFS the shortest A↔B path that
 * does NOT reuse `wallId`; that path plus `wallId` is the minimal cycle. BFS
 * (vs DFS) guarantees the tightest enclosing loop rather than a rambling one.
 */
export const findLoopThrough = (
  walls: ReadonlyArray<Wall>,
  wallId: string
): Pt[] | null => {
  const target = walls.find((w) => w.id === wallId);
  if (!target) return null;
  const { adj, coord } = buildGraph(walls);
  const startK = keyOf({ x: target.x1, y: target.y1 });
  const goalK = keyOf({ x: target.x2, y: target.y2 });
  if (startK === goalK) return null;

  // BFS from goal back to start, excluding the seed wall's own edge.
  const parent = new Map<string, string>();
  const visited = new Set<string>([goalK]);
  const queue: string[] = [goalK];
  let reached = false;
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === startK) {
      reached = true;
      break;
    }
    for (const edge of adj.get(cur) ?? []) {
      if (edge.wallId === wallId) continue; // can't reuse the closing wall
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      parent.set(edge.to, cur);
      queue.push(edge.to);
    }
  }
  if (!reached) return null;

  // Reconstruct start → … → goal by following parents (which point toward goal).
  const keys: string[] = [startK];
  let node = startK;
  while (node !== goalK) {
    const prev = parent.get(node);
    if (prev === undefined) return null; // defensive; shouldn't happen
    node = prev;
    keys.push(node);
  }
  if (keys.length < 3) return null; // 2 walls between the same pair = not a room
  return keys.map((k) => coord.get(k) as Pt);
};

/** True when two vertex lists describe the same polygon by vertex SET
 *  (order/rotation-independent) — used to skip re-creating an existing room. */
export const sameVertexSet = (
  a: ReadonlyArray<Pt>,
  b: ReadonlyArray<RoomVertex>
): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(keyOf));
  return a.every((p) => setB.has(keyOf(p)));
};

/** True when any existing room already occupies exactly `loop`'s vertices. */
export const loopMatchesAnyRoom = (
  loop: ReadonlyArray<Pt>,
  rooms: ReadonlyArray<{ points: RoomVertex[] }>
): boolean => rooms.some((r) => sameVertexSet(loop, r.points));

/** Direction-independent key for the edge between two vertices. */
const edgeKey = (a: Pt, b: Pt): string => {
  const ka = `${a.x}:${a.y}`;
  const kb = `${b.x}:${b.y}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/**
 * IDs of walls whose segment coincides with a room's polygon EDGE (a pair of
 * consecutive room vertices). Such walls are "absorbed" into the room — the
 * room outline represents them — so the editor hides them (no big white wall
 * strokes) and makes them non-selectable. Derived from current geometry, so a
 * room delete / reshape automatically re-evaluates which walls are absorbed.
 */
export const roomBoundaryWallIds = (
  walls: ReadonlyArray<Wall>,
  rooms: ReadonlyArray<{ points: RoomVertex[] }>
): Set<string> => {
  const roomEdges = new Set<string>();
  for (const r of rooms) {
    const n = r.points.length;
    for (let i = 0; i < n; i++) {
      const a = r.points[i];
      const b = r.points[(i + 1) % n];
      if (a !== undefined && b !== undefined) roomEdges.add(edgeKey(a, b));
    }
  }
  const ids = new Set<string>();
  if (roomEdges.size === 0) return ids;
  for (const w of walls) {
    if (roomEdges.has(edgeKey({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }))) {
      ids.add(w.id);
    }
  }
  return ids;
};
