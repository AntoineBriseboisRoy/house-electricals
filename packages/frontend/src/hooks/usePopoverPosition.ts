import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Shared popover/listbox positioner (2026-05).
 *
 * Extracted from the cycle-60 `Combobox` so any portal-mounted popover anchored
 * to a trigger gets the same behavior: fixed-position, viewport-clamped, and
 * flipped above the trigger when there isn't enough room below. Re-anchors on
 * scroll/resize so it tracks even inside an `overflow:auto` container (modal,
 * sidebar). Consumers: `ui/Combobox`, `components/BreakerComboField`.
 */
export type PopoverPosition =
  | { top: number; bottom?: undefined; left: number; width: number; maxHeight: number }
  | { top?: undefined; bottom: number; left: number; width: number; maxHeight: number };

export type UsePopoverPositionOptions = {
  /** Only computes while open. */
  isOpen: boolean;
  /** The anchor element the popover is positioned against. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Minimum popover width (defaults to the trigger width, clamped to this). */
  minWidth?: number;
  /** Maximum popover width. */
  maxWidth?: number;
  /** When the space below is under this many px (and there's more above), flip up. */
  flipThreshold?: number;
  /** Floor for the computed maxHeight. */
  minMaxHeight?: number;
};

const VIEWPORT_MARGIN = 8;
const GAP = 4;

export function usePopoverPosition({
  isOpen,
  triggerRef,
  minWidth = 240,
  maxWidth = 360,
  flipThreshold = 220,
  minMaxHeight = 160,
}: UsePopoverPositionOptions): PopoverPosition | null {
  const [pos, setPos] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const compute = (): void => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const desired = Math.max(rect.width, minWidth);
      const width = Math.min(desired, window.innerWidth - 2 * VIEWPORT_MARGIN, maxWidth);
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)
      );
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const flipUp = spaceBelow < flipThreshold && spaceAbove > spaceBelow;
      const maxHeight = Math.max(minMaxHeight, (flipUp ? spaceAbove : spaceBelow) - GAP);
      if (flipUp) {
        setPos({ bottom: window.innerHeight - rect.top + GAP, left, width, maxHeight });
      } else {
        setPos({ top: rect.bottom + GAP, left, width, maxHeight });
      }
    };
    compute();
    window.addEventListener('resize', compute);
    document.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      document.removeEventListener('scroll', compute, true);
    };
  }, [isOpen, triggerRef, minWidth, maxWidth, flipThreshold, minMaxHeight]);

  return pos;
}
