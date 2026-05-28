import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Cycle-60: Ported from HousesTracker `client/src/components/ui/FilterPopover.tsx`.
 *
 * Fixed-position panel anchored at `{ top, left }`. Viewport-clamped so it
 * never overflows on narrow phones (max-width: calc(100vw - 16px)). Carries
 * `data-filter-popover` for the useFilterPopover outside-click handler.
 *
 * Token-driven: --color-bg-surface-raised, --color-border-strong,
 * --shadow-lg, --radius-md (no Tailwind, no inline colors).
 */

export type FilterPopoverProps = {
  isOpen: boolean;
  popoverRef: RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Optional data-testid on the root for e2e selectors. */
  testId?: string;
};

const PANEL_WIDTH = 320;
const VIEWPORT_MARGIN = 8;

export const FilterPopover = ({
  isOpen,
  popoverRef,
  position,
  children,
  className,
  ariaLabel,
  testId,
}: FilterPopoverProps): JSX.Element | null => {
  const [clampedLeft, setClampedLeft] = useState<number>(() => {
    if (typeof window === 'undefined') return position.left;
    return Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
    );
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const recompute = (): void => {
      const panelWidth = popoverRef.current?.offsetWidth ?? PANEL_WIDTH;
      const next = Math.max(
        VIEWPORT_MARGIN,
        Math.min(position.left, window.innerWidth - panelWidth - VIEWPORT_MARGIN)
      );
      setClampedLeft(next);
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [isOpen, position.left, popoverRef]);

  if (!isOpen) return null;

  const classes = ['filter-popover', className].filter(Boolean).join(' ');

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={ariaLabel}
      data-filter-popover=""
      data-testid={testId ?? 'filter-popover'}
      style={{
        position: 'fixed',
        top: position.top,
        left: clampedLeft,
        zIndex: 1100,
        // Dynamic max-height — accounts for the actual trigger position so
        // the panel never overruns the viewport on a deeply-scrolled page.
        maxHeight: `calc(100dvh - ${position.top + 16}px)`,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
      className={classes}
    >
      {children}
    </div>
  );
};
