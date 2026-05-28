import type { Room } from '@he/shared';

/**
 * Auto-bind helper for G26 (cycle-32).
 *
 * Given a list of rooms on a floor and a (x, y) point in normalized
 * 0-10000 viewbox coords, return the first room whose rectangle contains
 * the point — or null if no room contains it.
 *
 * Boundary is inclusive on both axes: a pin dropped exactly on a wall
 * is considered to belong to the room on that wall. This matches the
 * user's intent ("on the wall counts as in the room").
 *
 * If multiple rooms overlap at the point, the FIRST match in the array
 * wins. Callers that need a specific tiebreak (e.g. smallest room, or
 * most-recently-created) should sort `rooms` before calling.
 */
export const findRoomForPoint = (
  rooms: ReadonlyArray<Room>,
  x: number,
  y: number
): Room | null => {
  for (const r of rooms) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return r;
    }
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
