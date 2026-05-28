/**
 * Snap-to-grid (G12 walls).
 *
 * Coords live in the 0-10000 normalized integer space (matches
 * components.posX/posY). Default step is 1/40 of 10000 = 250 — pinned in
 * CLAUDE.md "Wall editor (G12 walls)". The step is a constant; do NOT make
 * it user-configurable globally. Future per-floor configurability would
 * add a `grid_step` column to floors.
 */

export const SNAP_STEP = 250;

/** Snap a single coord to the nearest grid line, clamped to [0, 10000]. */
export const snap = (value: number, step: number = SNAP_STEP): number => {
  const snapped = Math.round(value / step) * step;
  if (snapped < 0) return 0;
  if (snapped > 10000) return 10000;
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
