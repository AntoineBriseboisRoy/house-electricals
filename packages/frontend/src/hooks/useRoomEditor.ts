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
 * Room-editor state machine (G12 rooms).
 *
 * Two interaction modes inside one hook:
 *
 *  - DRAW: pointerdown on empty canvas starts a drag → pointermove updates a
 *    ghost rectangle → pointerup commits via onCommit(rect). Snap applied
 *    to both corners.
 *
 *  - CORNER-DRAG: when a room is selected, four corner handles render.
 *    pointerdown on a handle starts a corner drag → pointermove updates a
 *    local current point → pointerup PATCHes the four (x,y,w,h) ints via
 *    onCornerCommit(roomId, corner, point).
 *
 * The two modes are mutually exclusive — drawing is ignored while a corner
 * drag is in flight. ESC cancels both.
 *
 * Mirrors useWallEditor's discipline: pointer-coord normalization via
 * container ref's getBoundingClientRect, window-pointerup as a defense-in-
 * depth listener, reset on deactivation.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export type DrawingRect = {
  /** Anchor point set on pointerdown (snapped). */
  anchor: Point;
  /** Current pointer point (snapped). Updates on pointermove. */
  current: Point;
};

export type CornerDrag = {
  roomId: string;
  corner: Corner;
  current: Point;
};

/** G26 cycle-32 — translate drag: user pointerdowns inside the selected
 *  room's body (NOT a corner) and drags to move the whole rect. The
 *  commit handler receives (dx, dy) — already snapped to grid. */
export type TranslateDrag = {
  roomId: string;
  /** Pointer position (in viewbox coords) where the drag started — used
   *  as the anchor against which dx/dy are computed each move. */
  anchor: Point;
  /** Current pointer position (in viewbox coords, snapped). */
  current: Point;
};

export type UseRoomEditorResult = {
  drawing: DrawingRect | null;
  cornerDrag: CornerDrag | null;
  translateDrag: TranslateDrag | null;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGElement>) => void;
  };
  /** Begin dragging a specific corner of a specific room. */
  startCornerDrag: (
    roomId: string,
    corner: Corner,
    e: ReactPointerEvent<SVGElement>
  ) => void;
  /** Begin translating a specific (already selected) room. */
  startTranslateDrag: (
    roomId: string,
    e: ReactPointerEvent<SVGElement>
  ) => void;
  reset: () => void;
};

type Options = {
  containerRef: RefObject<HTMLElement>;
  onCommit: (rect: Rect) => void | Promise<void>;
  onCornerCommit: (
    roomId: string,
    corner: Corner,
    point: Point
  ) => void | Promise<void>;
  /** G26 — fires after a translate drag releases. dx, dy are in viewbox
   *  units, already snapped to the grid. Zero-delta commits are skipped
   *  before the callback fires. */
  onTranslateCommit?: (
    roomId: string,
    dx: number,
    dy: number
  ) => void | Promise<void>;
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

/** Compute the rectangle bounding two corner points (snapped). */
export const rectFromCorners = (a: Point, b: Point): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return { x, y, w, h };
};

export const useRoomEditor = ({
  containerRef,
  onCommit,
  onCornerCommit,
  onTranslateCommit,
  active,
  screenToViewbox,
}: Options): UseRoomEditorResult => {
  const normalize = (
    e: ReactPointerEvent<SVGElement>,
    container: HTMLElement
  ): Point => {
    if (screenToViewbox !== undefined) {
      return screenToViewbox(e.clientX, e.clientY, container.getBoundingClientRect());
    }
    return defaultNormalize(e, container);
  };
  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [cornerDrag, setCornerDrag] = useState<CornerDrag | null>(null);
  const [translateDrag, setTranslateDrag] = useState<TranslateDrag | null>(null);
  const commitInFlight = useRef(false);

  const reset = useCallback(() => {
    setDrawing(null);
    setCornerDrag(null);
    setTranslateDrag(null);
    commitInFlight.current = false;
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, reset]);

  useEffect(() => {
    if (!active) reset();
  }, [active, reset]);

  const startCornerDrag = useCallback(
    (roomId: string, corner: Corner, e: ReactPointerEvent<SVGElement>): void => {
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
        // some browsers reject; ignore
      }
      setCornerDrag({ roomId, corner, current: snapped });
      setDrawing(null);
      setTranslateDrag(null);
    },
    [active, containerRef]
  );

  /** G26 cycle-32 — begin translating a (selected) room. The caller is
   *  responsible for checking that the user pointerdowned on the body of
   *  the room (not a corner handle). */
  const startTranslateDrag = useCallback(
    (roomId: string, e: ReactPointerEvent<SVGElement>): void => {
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
        // some browsers reject; ignore
      }
      setTranslateDrag({ roomId, anchor: snapped, current: snapped });
      setDrawing(null);
      setCornerDrag(null);
    },
    [active, containerRef]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      if (cornerDrag !== null) return;
      if (translateDrag !== null) return;
      if (commitInFlight.current) return;
      const container = containerRef.current;
      if (!container) return;
      e.preventDefault();
      const raw = normalize(e, container);
      const snapped = snapPoint(raw);
      // Begin a drag — anchor at this point, current follows.
      setDrawing({ anchor: snapped, current: snapped });
    },
    [active, cornerDrag, translateDrag, containerRef]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>): void => {
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;
      const raw = normalize(e, container);
      const snapped = snapPoint(raw);
      if (cornerDrag !== null) {
        setCornerDrag({ ...cornerDrag, current: snapped });
        return;
      }
      if (translateDrag !== null) {
        setTranslateDrag({ ...translateDrag, current: snapped });
        return;
      }
      if (drawing !== null) {
        setDrawing({ ...drawing, current: snapped });
      }
    },
    [active, cornerDrag, translateDrag, containerRef, drawing]
  );

  // Window pointerup commits the in-flight gesture.
  useEffect(() => {
    if (drawing === null && cornerDrag === null && translateDrag === null) return;
    const onUp = (): void => {
      if (cornerDrag !== null) {
        const f = cornerDrag;
        setCornerDrag(null);
        void onCornerCommit(f.roomId, f.corner, f.current);
        return;
      }
      if (translateDrag !== null) {
        const f = translateDrag;
        setTranslateDrag(null);
        const dx = f.current.x - f.anchor.x;
        const dy = f.current.y - f.anchor.y;
        // Skip no-op moves; snapping has already aligned to grid.
        if (dx === 0 && dy === 0) return;
        if (onTranslateCommit) void onTranslateCommit(f.roomId, dx, dy);
        return;
      }
      if (drawing !== null) {
        const rect = rectFromCorners(drawing.anchor, drawing.current);
        setDrawing(null);
        // Skip zero-area rects (drag without movement).
        if (rect.w <= 0 || rect.h <= 0) return;
        commitInFlight.current = true;
        void Promise.resolve(onCommit(rect)).finally(() => {
          commitInFlight.current = false;
        });
      }
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [drawing, cornerDrag, translateDrag, onCommit, onCornerCommit, onTranslateCommit]);

  return {
    drawing,
    cornerDrag,
    translateDrag,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
    },
    startCornerDrag,
    startTranslateDrag,
    reset,
  };
};
