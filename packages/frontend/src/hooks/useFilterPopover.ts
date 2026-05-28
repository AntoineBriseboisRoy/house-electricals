import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cycle-60: Ported from HousesTracker `client/src/hooks/useFilterPopover.ts`.
 *
 * Anchors a popover panel to a trigger button via fixed positioning. Tracks
 * open state, exposes refs to wire onto the button + popover, and provides
 * a stable `{ top, left }` that follows the button on scroll/resize.
 *
 * Outside-click handling runs in CAPTURE phase so it intercepts before any
 * other handler can fire. Elements marked with `data-portal-popover` or
 * `role="dialog"` are treated as "inside" — that's the escape hatch for
 * portalled comboboxes / modal dialogs opened from within the popover.
 */
export type UseFilterPopoverReturn = {
  isOpen: boolean;
  position: { top: number; left: number };
  buttonRef: React.RefObject<HTMLButtonElement>;
  popoverRef: React.RefObject<HTMLDivElement>;
  toggle: () => void;
  close: () => void;
};

export const useFilterPopover = (): UseFilterPopoverReturn => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Outside-click handler — capture-phase so it fires before any other handler.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      if (target instanceof Element) {
        // Portalled combobox listboxes opt out via this marker.
        if (target.closest('[data-portal-popover]')) return;
        // Modal dialog stacking — clicks inside a real modal must not close
        // the underlying filter popover.
        if (target.closest('[role="dialog"]')) return;
      }
      e.stopPropagation();
      e.preventDefault();
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('click', handler, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('click', handler, true);
    };
  }, [isOpen]);

  // Re-anchor on scroll so the popover follows the button.
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [isOpen]);

  const toggle = useCallback((): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
    setIsOpen((o) => !o);
  }, []);

  const close = useCallback((): void => setIsOpen(false), []);

  return { isOpen, position, buttonRef, popoverRef, toggle, close };
};
