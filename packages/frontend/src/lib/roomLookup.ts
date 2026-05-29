import type { Room, RoomVertex } from '@he/shared';

/** True when (x,y) lies on the segment a→b (collinear + within its bbox). */
const onSegment = (a: RoomVertex, b: RoomVertex, x: number, y: number): boolean => {
  const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  if (cross !== 0) return false;
  return (
    x >= Math.min(a.x, b.x) &&
    x <= Math.max(a.x, b.x) &&
    y >= Math.min(a.y, b.y) &&
    y <= Math.max(a.y, b.y)
  );
};

/**
 * Ray-casting point-in-polygon test (even-odd rule), boundary-INCLUSIVE.
 * Works for any simple polygon, including the 4-point rectangles the
 * rectangle tool produces. A point exactly on an edge counts as inside —
 * preserving the G26 "on the wall counts as in the room" intent.
 */
export const pointInPolygon = (
  points: ReadonlyArray<RoomVertex>,
  x: number,
  y: number
): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a === undefined || b === undefined) continue;
    if (onSegment(a, b, x, y)) return true; // on a boundary edge → inside
    const intersects =
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

/**
 * Auto-bind helper for G26 (cycle-32), extended for polygon rooms.
 *
 * Given a list of rooms on a floor and a (x, y) point in normalized viewbox
 * coords, return the first room whose POLYGON contains the point — or null.
 * Rectangles are 4-point polygons, so this subsumes the original rect test.
 *
 * If multiple rooms overlap at the point, the FIRST match in the array wins.
 * Callers that need a specific tiebreak should sort `rooms` before calling.
 */
export const findRoomForPoint = (
  rooms: ReadonlyArray<Room>,
  x: number,
  y: number
): Room | null => {
  for (const r of rooms) {
    if (pointInPolygon(r.points, x, y)) return r;
  }
  return null;
};

/**
 * Convenience: list every component-ish thing (anything with posX+posY)
 * whose pin falls inside the given rect. Used when a room is translated
 * to find which components should move with it.
 *
 * Operates on the OLD rect — the caller passes the rect before the move.
 */
export const findPointsInRect = <T extends { posX: number | null; posY: number | null }>(
  items: ReadonlyArray<T>,
  rect: { x: number; y: number; w: number; h: number }
): T[] => {
  const x2 = rect.x + rect.w;
  const y2 = rect.y + rect.h;
  return items.filter((c) => {
    if (c.posX === null || c.posY === null) return false;
    return c.posX >= rect.x && c.posX <= x2 && c.posY >= rect.y && c.posY <= y2;
  });
};
