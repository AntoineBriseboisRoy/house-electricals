import { COORD_MIN, COORD_MAX } from '@he/shared';

/**
 * Snap-to-grid (G12 walls).
 *
 * Coords live in the integer coordinate space (matches components.posX/posY).
 * The space is generously bounded (COORD_MIN..COORD_MAX in @he/shared) so the
 * plan feels effectively unbounded — the fixed 0-10000 viewBox is just the
 * window the viewport pans across. Default step is 50 viewbox units (was 250 —
 * lowered 2026-05 for finer corner/endpoint/vertex placement; the 250 grid was
 * too coarse). Pinned in CLAUDE.md "Wall editor (G12 walls)". The step is a
 * constant; do NOT make it user-configurable globally. Future per-floor
 * configurability would add a `grid_step` column to floors.
 */

export const SNAP_STEP = 50;

/** Snap a single coord to the nearest grid line, clamped to the coordinate
 *  space bounds (COORD_MIN..COORD_MAX). */
export const snap = (value: number, step: number = SNAP_STEP): number => {
  const snapped = Math.round(value / step) * step;
  if (snapped < COORD_MIN) return COORD_MIN;
  if (snapped > COORD_MAX) return COORD_MAX;
  return snapped;
};

/** Snap a 2D point. Returns integer coords. */
export const snapPoint = (
  p: { x: number; y: number },
  step: number = SNAP_STEP
): { x: number; y: number } => ({
  x: snap(p.x, step),
  y: snap(p.y, step),
});

/** How close (in viewbox units) a pointer must be to an existing vertex for
 *  the wall editor to snap to it exactly — "converging walls link together".
 *  ~1.4 grid cells: forgiving enough to catch an intended join, tight enough
 *  not to hijack a deliberate nearby point. */
export const VERTEX_SNAP_DIST = 350;

/**
 * Vertex-aware snap (G12+ wall linking). If `raw` is within VERTEX_SNAP_DIST
 * of an existing vertex, snap EXACTLY to that vertex (so the two wall ends
 * share a coordinate and become linked). Otherwise fall back to grid snap.
 * Vertices are already grid-aligned, so snapping to one stays on-grid.
 */
export const snapWithVertices = (
  p: { x: number; y: number },
  vertices: ReadonlyArray<{ x: number; y: number }>,
  step: number = SNAP_STEP
): { x: number; y: number } => {
  let best: { x: number; y: number } | null = null;
  let bestDist = VERTEX_SNAP_DIST;
  for (const v of vertices) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best !== null ? { x: best.x, y: best.y } : snapPoint(p, step);
};
