import { useCallback, useRef, useState, type PointerEvent, type RefObject } from 'react';

export type DropResult = { x: number; y: number } | null;

export type DragState = {
  id: string;
  ghostX: number;
  ghostY: number;
};

type Options = {
  mapRef: RefObject<HTMLElement | null>;
  onDrop: (id: string, drop: DropResult) => void;
};

/**
 * Single drag controller used by both unplaced-sidebar items and placed pins.
 *
 * pointerdown: capture pointer + record active drag id
 * pointermove: update ghost (clientX/Y for CSS-fixed positioning)
 * pointerup:   if release point is inside mapRef, normalize 0–10000 of its
 *              client rect and pass to onDrop. Else onDrop(id, null).
 * pointercancel: drop the drag without firing onDrop.
 *
 * The hook does NOT PATCH on pointermove — only the consumer's onDrop
 * callback decides whether to write, and only on pointerup. See CLAUDE.md.
 */
export const useMapDrag = ({ mapRef, onDrop }: Options) => {
  const [drag, setDrag] = useState<DragState | null>(null);
  const activeId = useRef<string | null>(null);

  const begin = useCallback(
    (id: string) => (e: PointerEvent<HTMLElement>) => {
      // Only respond to primary button / touch / pen.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      activeId.current = id;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id, ghostX: e.clientX, ghostY: e.clientY });
    },
    []
  );

  const handlePointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (activeId.current === null) return;
    setDrag((prev) => (prev ? { ...prev, ghostX: e.clientX, ghostY: e.clientY } : prev));
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const id = activeId.current;
      activeId.current = null;
      setDrag(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      if (id === null) return;
      const map = mapRef.current;
      if (!map) {
        onDrop(id, null);
        return;
      }
      // Hit-test the map at the release point.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target === null || !map.contains(target)) {
        onDrop(id, null);
        return;
      }
      const rect = map.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        onDrop(id, null);
        return;
      }
      const xFrac = (e.clientX - rect.left) / rect.width;
      const yFrac = (e.clientY - rect.top) / rect.height;
      if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) {
        onDrop(id, null);
        return;
      }
      onDrop(id, {
        x: Math.round(xFrac * 10000),
        y: Math.round(yFrac * 10000),
      });
    },
    [mapRef, onDrop]
  );

  const handlePointerCancel = useCallback((_e: PointerEvent<HTMLElement>) => {
    activeId.current = null;
    setDrag(null);
  }, []);

  return {
    drag,
    /** Spread these on each draggable element. */
    handlersFor: (id: string) => ({
      onPointerDown: begin(id),
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
  };
};
