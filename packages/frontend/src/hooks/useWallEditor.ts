import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { snapPoint } from '../lib/snap.js';

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
  /** Begin dragging an endpoint of a specific wall. */
  startEndpointDrag: (
    wallId: string,
    endpoint: 1 | 2,
    e: ReactPointerEvent<SVGElement>
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
};

const defaultNormalize = (
  e: ReactPointerEvent<SVGElement>,
  container: HTMLElement
): Point => {
  const rect = container.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 10000;
  const y = ((e.clientY - rect.top) / rect.height) * 10000;
  return { x, y };
};

export const useWallEditor = ({
  containerRef,
  onCommit,
  onEndpointCommit,
  active,
  screenToViewbox,
}: Options): UseWallEditorResult => {
  const normalize = (
    e: ReactPointerEvent<SVGElement>,
    container: HTMLElement
  ): Point => {
    if (screenToViewbox !== undefined) {
      return screenToViewbox(e.clientX, e.clientY, container.getBoundingClientRect());
    }
    return defaultNormalize(e, container);
  };
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
    (wallId: string, endpoint: 1 | 2, e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;
      e.stopPropagation();
      e.preventDefault();
      const raw = normalize(e, container);
      const snapped = snapPoint(raw);
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
      const snapped = snapPoint(raw);

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
      const container = containerRef.current;
      if (!container) return;
      const raw = normalize(e, container);
      const snapped = snapPoint(raw);

      // Endpoint drag in flight — track snapped current point.
      if (endpointDrag !== null) {
        setEndpointDrag({ ...endpointDrag, current: snapped });
        return;
      }
      // Two-tap draw flow — track ghost.
      if (firstEndpoint !== null) {
        setGhostEndpoint(snapped);
      }
    },
    [active, containerRef, endpointDrag, firstEndpoint]
  );

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
