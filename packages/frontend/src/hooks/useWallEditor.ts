import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { snapPoint, snapWithVertices } from '../lib/snap.js';

/**
 * Wall-editor state machine (G12).
 *
 * idle → first-endpoint-set → (on second tap) emit onCommit + back to idle
 *
 * Pointer-coord conversion uses the consumer's container ref
 * (PanelMapScreen passes mapRef on the .floor-plan div). Container is
 * normalized to 0-10000 — same coord space as components.posX/posY and
 * walls.x{1,2}/y{1,2}.
 *
 * ESC + tap-outside cancel the first endpoint.
 */

export type Point = { x: number; y: number };

/** Active endpoint drag state. */
export type EndpointDrag = {
  wallId: string;
  endpoint: 1 | 2; // which endpoint we're dragging
  /** Endpoint position at drag start. Used so a press-without-move releases
   *  as a no-op (don't snap-jump the endpoint just because the user tapped
   *  slightly off the exact pixel). */
  origin: Point;
  /** Current (snapped) position — initialized to `origin`, updates only on
   *  pointermove. */
  current: Point;
};

/** Active whole-wall translate drag state. Both endpoints move by the
 *  (snapped) delta between `anchor` and `current`. */
export type WallDrag = {
  wallId: string;
  /** Snapped pointer position at drag start — the anchor delta is measured
   *  against this. */
  anchor: Point;
  /** Snapped current pointer position. */
  current: Point;
};

export type UseWallEditorResult = {
  /** Current pending first endpoint (snapped); null when idle. */
  firstEndpoint: Point | null;
  /** Ghost second endpoint following the pointer when first is set. */
  ghostEndpoint: Point | null;
  /** Active endpoint drag (if any). */
  endpointDrag: EndpointDrag | null;
  /** Active whole-wall translate drag (if any). */
  wallDrag: WallDrag | null;
  /** Handlers to spread onto the interactive SVG. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGElement>) => void;
  };
  /** Begin dragging an endpoint of a specific wall. Accepts any Element so
   *  HTML overlay handles (not just SVG circles) can drive it. `origin` is the
   *  endpoint's current position so a release-without-move is a no-op. */
  startEndpointDrag: (
    wallId: string,
    endpoint: 1 | 2,
    origin: Point,
    e: ReactPointerEvent<Element>
  ) => void;
  /** Begin translating a whole (already-selected) wall by drag. */
  startWallDrag: (wallId: string, e: ReactPointerEvent<Element>) => void;
  /** Force-reset the state machine (called when user toggles edit-mode off). */
  reset: () => void;
};

type Options = {
  /** Container ref — used to normalize client coords to 0-10000. */
  containerRef: RefObject<HTMLElement>;
  /** Called when the user commits a wall via the second tap. The two
   *  endpoints are already snapped to grid. */
  onCommit: (start: Point, end: Point) => void | Promise<void>;
  /** Called on pointerup of an endpoint drag with the final snapped point. */
  onEndpointCommit: (
    wallId: string,
    endpoint: 1 | 2,
    point: Point
  ) => void | Promise<void>;
  /** Called on pointerup of a whole-wall translate drag with the (snapped,
   *  grid-aligned) delta. Skipped when the delta is zero. */
  onWallMoveCommit?: (
    wallId: string,
    dx: number,
    dy: number
  ) => void | Promise<void>;
  /** Whether the editor is active; when false, handlers are no-ops. */
  active: boolean;
  /** Optional viewport-aware coord transformer (G15). When provided, the
   *  hook calls this instead of the built-in normalize so drawing on a
   *  zoomed/panned canvas produces correct viewbox coords. */
  screenToViewbox?: (clientX: number, clientY: number, rect: DOMRect) => Point;
  /** Optional supplier of existing vertices (other wall endpoints + room
   *  polygon vertices) to snap to. When a drawn/dragged endpoint lands within
   *  VERTEX_SNAP_DIST of one, it snaps EXACTLY onto it so converging walls
   *  share a coordinate ("link together"). Called per snap; keep it cheap. */
  getSnapVertices?: () => ReadonlyArray<Point>;
};

export const useWallEditor = ({
  containerRef,
  onCommit,
  onEndpointCommit,
  onWallMoveCommit,
  active,
  screenToViewbox,
  getSnapVertices,
}: Options): UseWallEditorResult => {
  // Keep the latest vertex supplier in a ref so `snapWithTargets` has a stable
  // identity (no callback-dep churn) while always reading current vertices.
  const snapVerticesRef = useRef(getSnapVertices);
  snapVerticesRef.current = getSnapVertices;
  /** Grid snap, upgraded to vertex snap when a supplier is provided. */
  const snapWithTargets = useCallback((p: Point): Point => {
    const fn = snapVerticesRef.current;
    return fn ? snapWithVertices(p, fn()) : snapPoint(p);
  }, []);
  // Normalize raw client coords (React synthetic events OR native window
  // PointerEvents) to the 0-10000 viewbox space, applying the optional
  // viewport transform when supplied (G15).
  const normalizeClient = useCallback(
    (clientX: number, clientY: number, container: HTMLElement): Point => {
      const rect = container.getBoundingClientRect();
      if (screenToViewbox !== undefined) {
        return screenToViewbox(clientX, clientY, rect);
      }
      return {
        x: ((clientX - rect.left) / rect.width) * 10000,
        y: ((clientY - rect.top) / rect.height) * 10000,
      };
    },
    [screenToViewbox]
  );
  const normalize = (
    e: ReactPointerEvent<Element>,
    container: HTMLElement
  ): Point => normalizeClient(e.clientX, e.clientY, container);
  const [firstEndpoint, setFirstEndpoint] = useState<Point | null>(null);
  const [ghostEndpoint, setGhostEndpoint] = useState<Point | null>(null);
  const [endpointDrag, setEndpointDrag] = useState<EndpointDrag | null>(null);
  const [wallDrag, setWallDrag] = useState<WallDrag | null>(null);
  /** Track the in-flight committing so a quick double-tap doesn't fire twice. */
  const commitInFlight = useRef(false);

  const reset = useCallback(() => {
    setFirstEndpoint(null);
    setGhostEndpoint(null);
    setEndpointDrag(null);
    setWallDrag(null);
    commitInFlight.current = false;
  }, []);

  // ESC cancels the first endpoint.
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, reset]);

  // When the editor deactivates (toggle off), clear in-flight state.
  useEffect(() => {
    if (!active) reset();
  }, [active, reset]);

  const startEndpointDrag = useCallback(
    (
      wallId: string,
      endpoint: 1 | 2,
      origin: Point,
      e: ReactPointerEvent<Element>
    ): void => {
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;
      e.stopPropagation();
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // some browsers reject setPointerCapture on certain elements; ignore
      }
      // Initialize `current` to the endpoint's existing position — NOT the
      // snapped pointer-down point. So a tap-without-drag releases as a no-op
      // (the endpoint won't snap-jump just because the finger landed a few
      // pixels off). The position only changes once the pointer actually moves.
      setEndpointDrag({ wallId, endpoint, origin, current: origin });
      // While endpoint-dragging, clear any pending first-tap state from the
      // two-tap draw flow.
      setFirstEndpoint(null);
      setGhostEndpoint(null);
    },
    [active, containerRef]
  );

  const startWallDrag = useCallback(
    (wallId: string, e: ReactPointerEvent<Element>): void => {
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;
      e.stopPropagation();
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // some browsers reject setPointerCapture on certain elements; ignore
      }
      // Grid-snap (NOT vertex-snap) the anchor — a translate measures a delta,
      // so snapping the anchor to a far vertex would be wrong. The endpoints
      // keep their relative geometry; the whole wall shifts by the delta.
      const snapped = snapPoint(normalize(e, container));
      setWallDrag({ wallId, anchor: snapped, current: snapped });
      setFirstEndpoint(null);
      setGhostEndpoint(null);
      setEndpointDrag(null);
    },
    [active, containerRef]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      // If we're mid endpoint- or wall-drag, ignore the draw-tool tap.
      if (endpointDrag !== null || wallDrag !== null) return;
      const container = containerRef.current;
      if (!container) return;
      if (commitInFlight.current) return;
      e.preventDefault();
      const raw = normalize(e, container);
      const snapped = snapWithTargets(raw);

      if (firstEndpoint === null) {
        setFirstEndpoint(snapped);
        setGhostEndpoint(snapped);
        return;
      }

      // Second tap — commit.
      commitInFlight.current = true;
      const start = firstEndpoint;
      const end = snapped;
      setFirstEndpoint(null);
      setGhostEndpoint(null);
      void Promise.resolve(onCommit(start, end)).finally(() => {
        commitInFlight.current = false;
      });
    },
    [active, containerRef, endpointDrag, wallDrag, firstEndpoint, onCommit]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      // Endpoint + wall drags are tracked at the window level (below) so they
      // keep updating even when the pointer leaves the SVG or the gesture
      // started from an HTML overlay handle. The SVG handler only owns the
      // two-tap draw ghost.
      if (endpointDrag !== null || wallDrag !== null) return;
      if (firstEndpoint === null) return;
      const container = containerRef.current;
      if (!container) return;
      setGhostEndpoint(snapWithTargets(normalize(e, container)));
    },
    [active, containerRef, endpointDrag, wallDrag, firstEndpoint]
  );

  // Window-level pointermove tracks endpoint drags. Handles may be HTML
  // overlays (CSS %-space, immune to preserveAspectRatio="none" distortion)
  // that pointer-capture the gesture, so the SVG's onPointerMove never fires.
  // Functional setState avoids stale closures; the effect re-registers only
  // on the null↔active edge.
  const isDraggingHandle = endpointDrag !== null || wallDrag !== null;
  useEffect(() => {
    if (!isDraggingHandle) return;
    const onMove = (ev: PointerEvent): void => {
      const container = containerRef.current;
      if (!container) return;
      const raw = normalizeClient(ev.clientX, ev.clientY, container);
      // Endpoint drag snaps to vertices (so it can re-link to a neighbor);
      // wall translate snaps to grid (a delta — vertex snap is meaningless).
      setEndpointDrag((cur) =>
        cur ? { ...cur, current: snapWithTargets(raw) } : cur
      );
      setWallDrag((cur) => (cur ? { ...cur, current: snapPoint(raw) } : cur));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [isDraggingHandle, containerRef, normalizeClient, snapWithTargets]);

  // Wire pointerup as a window-level listener so we catch releases outside
  // the SVG hit-rect (the SVG already pointer-captures, but defense in depth).
  useEffect(() => {
    if (endpointDrag === null && wallDrag === null) return;
    const onUp = (): void => {
      if (endpointDrag !== null) {
        const f = endpointDrag;
        setEndpointDrag(null);
        // Skip no-op releases (a tap with no real drag leaves the endpoint
        // exactly where it was — see startEndpointDrag origin init).
        if (f.current.x !== f.origin.x || f.current.y !== f.origin.y) {
          void onEndpointCommit(f.wallId, f.endpoint, f.current);
        }
      }
      if (wallDrag !== null) {
        const f = wallDrag;
        setWallDrag(null);
        const dx = f.current.x - f.anchor.x;
        const dy = f.current.y - f.anchor.y;
        if ((dx !== 0 || dy !== 0) && onWallMoveCommit) {
          void onWallMoveCommit(f.wallId, dx, dy);
        }
      }
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [endpointDrag, wallDrag, onEndpointCommit, onWallMoveCommit]);

  return {
    firstEndpoint,
    ghostEndpoint,
    endpointDrag,
    wallDrag,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
    },
    startEndpointDrag,
    startWallDrag,
    reset,
  };
};
