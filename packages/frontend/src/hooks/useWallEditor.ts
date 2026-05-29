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
  /** Current (snapped) position — updates on pointermove. */
  current: Point;
};

export type UseWallEditorResult = {
  /** Current pending first endpoint (snapped); null when idle. */
  firstEndpoint: Point | null;
  /** Ghost second endpoint following the pointer when first is set. */
  ghostEndpoint: Point | null;
  /** Active endpoint drag (if any). */
  endpointDrag: EndpointDrag | null;
  /** Handlers to spread onto the interactive SVG. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGElement>) => void;
  };
  /** Begin dragging an endpoint of a specific wall. Accepts any Element so
   *  HTML overlay handles (not just SVG circles) can drive it. */
  startEndpointDrag: (
    wallId: string,
    endpoint: 1 | 2,
    e: ReactPointerEvent<Element>
  ) => void;
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
  /** Track the in-flight committing so a quick double-tap doesn't fire twice. */
  const commitInFlight = useRef(false);

  const reset = useCallback(() => {
    setFirstEndpoint(null);
    setGhostEndpoint(null);
    setEndpointDrag(null);
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
    (wallId: string, endpoint: 1 | 2, e: ReactPointerEvent<Element>): void => {
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;
      e.stopPropagation();
      e.preventDefault();
      const raw = normalize(e, container);
      const snapped = snapWithTargets(raw);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // some browsers reject setPointerCapture on certain elements; ignore
      }
      setEndpointDrag({ wallId, endpoint, current: snapped });
      // While endpoint-dragging, clear any pending first-tap state from the
      // two-tap draw flow.
      setFirstEndpoint(null);
      setGhostEndpoint(null);
    },
    [active, containerRef]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      // If we're mid endpoint-drag, ignore the draw-tool tap.
      if (endpointDrag !== null) return;
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
    [active, containerRef, endpointDrag, firstEndpoint, onCommit]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      // Endpoint drags are tracked at the window level (below) so they keep
      // updating even when the pointer leaves the SVG or the gesture started
      // from an HTML overlay handle. The SVG handler only owns the two-tap
      // draw ghost.
      if (endpointDrag !== null) return;
      if (firstEndpoint === null) return;
      const container = containerRef.current;
      if (!container) return;
      setGhostEndpoint(snapWithTargets(normalize(e, container)));
    },
    [active, containerRef, endpointDrag, firstEndpoint]
  );

  // Window-level pointermove tracks endpoint drags. Handles may be HTML
  // overlays (CSS %-space, immune to preserveAspectRatio="none" distortion)
  // that pointer-capture the gesture, so the SVG's onPointerMove never fires.
  // Functional setState avoids stale closures; the effect re-registers only
  // on the null↔active edge.
  const isEndpointDragging = endpointDrag !== null;
  useEffect(() => {
    if (!isEndpointDragging) return;
    const onMove = (ev: PointerEvent): void => {
      const container = containerRef.current;
      if (!container) return;
      const snapped = snapWithTargets(
        normalizeClient(ev.clientX, ev.clientY, container)
      );
      setEndpointDrag((cur) => (cur ? { ...cur, current: snapped } : cur));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [isEndpointDragging, containerRef, normalizeClient]);

  // Wire pointerup as a window-level listener so we catch releases outside
  // the SVG hit-rect (the SVG already pointer-captures, but defense in depth).
  useEffect(() => {
    if (endpointDrag === null) return;
    const onUp = (): void => {
      const finalized = endpointDrag;
      setEndpointDrag(null);
      void onEndpointCommit(finalized.wallId, finalized.endpoint, finalized.current);
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [endpointDrag, onEndpointCommit]);

  return {
    firstEndpoint,
    ghostEndpoint,
    endpointDrag,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
    },
    startEndpointDrag,
    reset,
  };
};
