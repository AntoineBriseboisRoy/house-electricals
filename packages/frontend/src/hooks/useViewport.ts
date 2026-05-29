import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

/**
 * Pan + zoom viewport for the G15 desktop map builder.
 *
 * State lives client-side, per-mount. Never persisted to URL or DB —
 * pinned in CLAUDE.md "Desktop map builder (G15)". A floor's geometry
 * is in normalized 0-10000 viewbox units; the viewport applies a scale
 * + translate on top so the user can zoom in and pan around.
 *
 * Coord math:
 *
 *   viewbox = (screen - rect.origin) / rect.width * 10000 / scale - tx
 *
 * (and the same for y). The `screenToViewbox` helper is the canonical
 * conversion — editors MUST use it to translate pointer events,
 * otherwise drawing in a zoomed view produces wrong coords.
 */

export type Viewport = {
  /** Current zoom factor. 1 = fit. Clamped to [0.25, 8]. */
  scale: number;
  /** Translation in viewbox units (0-10000), applied BEFORE scale. */
  tx: number;
  ty: number;
};

export type Point = { x: number; y: number };

/** Axis-aligned bounding box in 0-10000 floor coords. */
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// MIN_SCALE is intentionally tiny: the coordinate space is far larger than
// the 0-10000 viewBox window (see COORD_MIN/MAX in @he/shared), so fit-to-
// content must be able to zoom way out to frame a sprawling floor plan.
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const INITIAL: Viewport = { scale: 1, tx: 0, ty: 0 };

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export type UseViewportResult = {
  viewport: Viewport;
  /** SVG transform attribute string for the <g> wrapping geometry.
   *  Apply via `<g transform={transformAttr}>` — units are viewbox units,
   *  not pixels. Don't use CSS transform here. */
  transformAttr: string;
  /** Convert a screen-coord PointerEvent (or clientX/Y + rect) to the
   *  0-10000 viewbox coord that lives under the cursor right now. */
  screenToViewbox: (clientX: number, clientY: number, rect: DOMRect) => Point;
  /** Zoom by `factor` keeping the point under (clientX, clientY) fixed. */
  zoomAt: (clientX: number, clientY: number, factor: number, rect: DOMRect) => void;
  /** Pan by viewbox-unit deltas. */
  pan: (dx: number, dy: number) => void;
  /** Restore initial scale=1, tx=ty=0. */
  reset: () => void;
  /** Frame a bounding box (0-10000 floor coords) so it fills the canvas
   *  centered, with `padding` viewbox units of breathing room on each
   *  edge. Independent of the pixel rect — works purely in viewbox space
   *  (the SVG uses preserveAspectRatio="none", so 0-10000 maps to the
   *  full canvas on both axes regardless of aspect). */
  fitTo: (bounds: Bounds, padding?: number) => void;
  /** Step the zoom by `factor` around the canvas center (no rect needed).
   *  Used by the on-screen +/- buttons. */
  zoomBy: (factor: number) => void;
  /** Handler to spread onto the canvas div: mouse-wheel zoom + pan. */
  onWheel: (e: ReactWheelEvent<HTMLDivElement>) => void;
  /** Handlers for two-finger pinch zoom. Spread onto the canvas div. */
  pinchHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  };
};

export const useViewport = (): UseViewportResult => {
  const [viewport, setViewport] = useState<Viewport>(INITIAL);

  // Track active touch pointers for pinch detection.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const screenToViewbox = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): Point => {
      // 1. Convert to viewbox coords IGNORING transform (the existing
      //    formula from useWallEditor / useRoomEditor — px → 0-10000).
      // 2. Then undo the viewport transform: subtract translate, divide
      //    by scale. This gives the underlying floor coord.
      const baseX = ((clientX - rect.left) / rect.width) * 10000;
      const baseY = ((clientY - rect.top) / rect.height) * 10000;
      return {
        x: (baseX - viewport.tx) / viewport.scale,
        y: (baseY - viewport.ty) / viewport.scale,
      };
    },
    [viewport]
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number, rect: DOMRect): void => {
      setViewport((v) => {
        const nextScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
        const realFactor = nextScale / v.scale;
        // Keep the viewbox coord under the cursor fixed by adjusting tx/ty.
        // viewbox_x = (screen_x - tx) / scale = ((screen_x - tx') / scale')
        // → tx' = screen_x - realFactor * (screen_x - tx)
        const baseX = ((clientX - rect.left) / rect.width) * 10000;
        const baseY = ((clientY - rect.top) / rect.height) * 10000;
        const nextTx = baseX - realFactor * (baseX - v.tx);
        const nextTy = baseY - realFactor * (baseY - v.ty);
        return { scale: nextScale, tx: nextTx, ty: nextTy };
      });
    },
    []
  );

  const pan = useCallback((dx: number, dy: number): void => {
    setViewport((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }, []);

  const reset = useCallback((): void => {
    setViewport(INITIAL);
  }, []);

  const fitTo = useCallback((bounds: Bounds, padding = 700): void => {
    setViewport(() => {
      // Guard against zero/near-zero spans (a single pin, a perfectly
      // axis-aligned wall) so we don't divide by zero or zoom to MAX on
      // a dot. A floor's content always reads better with a minimum span.
      const MIN_SPAN = 1200;
      const bw = Math.max(bounds.maxX - bounds.minX, MIN_SPAN);
      const bh = Math.max(bounds.maxY - bounds.minY, MIN_SPAN);
      const avail = 10000 - 2 * padding;
      const scale = clamp(Math.min(avail / bw, avail / bh), MIN_SCALE, MAX_SCALE);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      // Map content center onto the viewbox center (5000,5000).
      return { scale, tx: 5000 - scale * cx, ty: 5000 - scale * cy };
    });
  }, []);

  const zoomBy = useCallback((factor: number): void => {
    setViewport((v) => {
      const nextScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const realFactor = nextScale / v.scale;
      // Keep the viewbox center (5000,5000) fixed.
      const nextTx = 5000 - realFactor * (5000 - v.tx);
      const nextTy = 5000 - realFactor * (5000 - v.ty);
      return { scale: nextScale, tx: nextTx, ty: nextTy };
    });
  }, []);

  // Mouse wheel: ctrl/cmd → zoom; plain → vertical pan; shift → horizontal.
  // deltaY > 0 means scroll down (away from user) → zoom OUT.
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>): void => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        zoomAt(e.clientX, e.clientY, factor, rect);
        return;
      }
      // Plain wheel = pan. Convert deltaY (px) to viewbox units via
      // current rect scale.
      const dyViewbox = (e.deltaY / rect.height) * 10000;
      const dxViewbox = (e.deltaX / rect.width) * 10000;
      if (e.shiftKey) {
        // shift+wheel = horizontal pan (use deltaY if deltaX is 0)
        pan(-(dxViewbox !== 0 ? dxViewbox : dyViewbox), 0);
      } else {
        pan(-dxViewbox, -dyViewbox);
      }
    },
    [pan, zoomAt]
  );

  // Pinch: track 2 pointers; on move with both active, compute distance ratio.
  const lastPinchDistRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.pointerType !== 'touch') return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        // Initialize pinch distance.
        const [a, b] = Array.from(pointersRef.current.values());
        if (a && b) {
          lastPinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
        }
      }
    },
    []
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.pointerType !== 'touch') return;
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2 && lastPinchDistRef.current !== null) {
        const pts = Array.from(pointersRef.current.values());
        const a = pts[0];
        const b = pts[1];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0 && lastPinchDistRef.current > 0) {
          const factor = dist / lastPinchDistRef.current;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(midX, midY, factor, rect);
        }
        lastPinchDistRef.current = dist;
      }
    },
    [zoomAt]
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch') return;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      lastPinchDistRef.current = null;
    }
  }, []);

  // SVG transform attribute — order matters. `translate(tx ty) scale(s)`
  // means "first scale around the origin, then translate". Combined with
  // the inverse math in `screenToViewbox` this gives consistent zoom-at-
  // cursor behavior. Units are viewbox units (0-10000), not pixels.
  const transformAttr = `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`;

  return {
    viewport,
    transformAttr,
    screenToViewbox,
    zoomAt,
    pan,
    reset,
    fitTo,
    zoomBy,
    onWheel,
    pinchHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
};
