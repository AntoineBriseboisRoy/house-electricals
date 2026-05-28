import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip primitive (cycle-75).
 *
 * Canonical custom-tooltip replacing native `title=""` for genuinely-
 * informational content. Trigger must be exactly ONE React element;
 * Tooltip clones it to thread `aria-describedby` + pointer/focus/touch
 * handlers.
 *
 * Activation:
 *   - Hover (pointerenter): scheduled-open at 250ms; pointerleave cancels
 *     + closes.
 *   - Keyboard focus: opens immediately on focus; closes on blur.
 *   - Touch long-press: scheduled-open at `longPressMs` (default 500ms);
 *     touchend / touchmove cancels + closes.
 *
 * A11y (Lockin FATAL #5): generates a stable `useId()` value; sets
 * `aria-describedby={id}` on the trigger via cloneElement, and applies
 * `role="tooltip"` + `id={id}` on the body. NOT a substitute for
 * aria-label — aria-label remains the accessible NAME; tooltip is the
 * DESCRIPTION.
 *
 * Portal-mounted to `document.body` (Lockin #2) so the tooltip body
 * escapes `overflow:hidden` scroll containers (e.g. panel-viz scroll
 * wrapper). Position fixed; clamped on scroll/resize via passive
 * listeners.
 *
 * Reduced-motion: enter animation is fade-only (no movement) — the
 * `he-fade-in` keyframe at `--motion-duration-fast` is the entire
 * presentation transition. Existing global reduced-motion media-query
 * zeroes the duration token automatically.
 */

export type TooltipSide = 'top' | 'bottom';

export type TooltipProps = {
  /** Tooltip body content. */
  content: ReactNode;
  /** Preferred side. Default 'top'. Auto-flips to opposite side when
   *  clamping against viewport edge would push it offscreen. */
  side?: TooltipSide;
  /** Touch long-press activation delay (ms). Default 500. */
  longPressMs?: number;
  /** Optional data-testid on the tooltip body element (NO default —
   *  opt-in only, per cycle-72/74 Card+Spinner precedent). */
  testId?: string;
  /** Trigger element — MUST be exactly one React element. */
  children: ReactElement;
};

const HOVER_OPEN_DELAY_MS = 250;
const VIEWPORT_PAD = 8;
const GAP_FROM_TRIGGER = 8;

type Pos = { left: number; top: number; side: TooltipSide };

export const Tooltip = ({
  content,
  side = 'top',
  longPressMs = 500,
  testId,
  children,
}: TooltipProps): JSX.Element => {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);

  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const computePosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const body = bodyRef.current;
    if (!trigger || !body) return;
    const tRect = trigger.getBoundingClientRect();
    const bRect = body.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Try preferred side first.
    let actualSide: TooltipSide = side;
    let top =
      actualSide === 'top'
        ? tRect.top - bRect.height - GAP_FROM_TRIGGER
        : tRect.bottom + GAP_FROM_TRIGGER;

    // Flip if it would clip offscreen.
    if (actualSide === 'top' && top < VIEWPORT_PAD) {
      actualSide = 'bottom';
      top = tRect.bottom + GAP_FROM_TRIGGER;
    } else if (
      actualSide === 'bottom' &&
      top + bRect.height > vh - VIEWPORT_PAD
    ) {
      actualSide = 'top';
      top = tRect.top - bRect.height - GAP_FROM_TRIGGER;
    }

    // Clamp top to viewport (defensive).
    top = Math.max(
      VIEWPORT_PAD,
      Math.min(top, vh - bRect.height - VIEWPORT_PAD)
    );

    // Horizontal: center on trigger, then clamp.
    let left = tRect.left + tRect.width / 2 - bRect.width / 2;
    left = Math.max(
      VIEWPORT_PAD,
      Math.min(left, vw - bRect.width - VIEWPORT_PAD)
    );

    setPos({ left, top, side: actualSide });
  }, [side]);

  // Recompute on open + on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    // Defer one frame so the body has been mounted + measured.
    const raf = window.requestAnimationFrame(() => computePosition());
    const handleReflow = (): void => computePosition();
    window.addEventListener('scroll', handleReflow, { passive: true, capture: true });
    window.addEventListener('resize', handleReflow, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', handleReflow, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', handleReflow);
    };
  }, [open, computePosition]);

  // Cleanup any pending open timer on unmount.
  useEffect(() => {
    return () => clearOpenTimer();
  }, [clearOpenTimer]);

  const scheduleOpen = useCallback(
    (delayMs: number): void => {
      clearOpenTimer();
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setOpen(true);
      }, delayMs);
    },
    [clearOpenTimer]
  );

  const closeNow = useCallback((): void => {
    clearOpenTimer();
    setOpen(false);
    setPos(null);
  }, [clearOpenTimer]);

  // Exactly one child element — validate at render.
  const child = Children.only(children);
  if (!isValidElement(child)) {
    // eslint-disable-next-line no-console
    console.warn('[Tooltip] children must be a single React element');
    return <>{children}</>;
  }

  type TriggerProps = {
    ref?: (node: HTMLElement | null) => void;
    'aria-describedby'?: string;
    onPointerEnter?: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave?: (e: ReactPointerEvent<HTMLElement>) => void;
    onFocus?: (e: ReactFocusEvent<HTMLElement>) => void;
    onBlur?: (e: ReactFocusEvent<HTMLElement>) => void;
    onTouchStart?: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchEnd?: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchMove?: (e: ReactTouchEvent<HTMLElement>) => void;
  };

  const originalProps = child.props as TriggerProps & {
    'aria-describedby'?: string;
  };

  // Compose existing aria-describedby (if present) with the tooltip id so we
  // don't trample the consumer's own descriptions.
  const composedDescribedBy = [originalProps['aria-describedby'], tooltipId]
    .filter(Boolean)
    .join(' ');

  const handleRefMerge = (node: HTMLElement | null): void => {
    triggerRef.current = node;
    // Forward to the consumer's ref if present (function refs only — Tooltip
    // doesn't peek at object refs to keep the surface small).
    const childRef = (child as unknown as { ref?: unknown }).ref;
    if (typeof childRef === 'function') {
      (childRef as (n: HTMLElement | null) => void)(node);
    }
  };

  const triggerExtra: TriggerProps = {
    ref: handleRefMerge,
    'aria-describedby': composedDescribedBy,
    onPointerEnter: (e) => {
      // Pointer types: 'mouse' | 'pen' | 'touch'. Touch is handled by
      // onTouchStart's long-press; ignore pointerenter for touch so we
      // don't double-schedule.
      if (e.pointerType === 'touch') return;
      scheduleOpen(HOVER_OPEN_DELAY_MS);
      originalProps.onPointerEnter?.(e);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'touch') return;
      closeNow();
      originalProps.onPointerLeave?.(e);
    },
    onFocus: (e) => {
      setOpen(true);
      originalProps.onFocus?.(e);
    },
    onBlur: (e) => {
      closeNow();
      originalProps.onBlur?.(e);
    },
    onTouchStart: (e) => {
      scheduleOpen(longPressMs);
      originalProps.onTouchStart?.(e);
    },
    onTouchEnd: (e) => {
      closeNow();
      originalProps.onTouchEnd?.(e);
    },
    onTouchMove: (e) => {
      closeNow();
      originalProps.onTouchMove?.(e);
    },
  };

  const clonedTrigger = cloneElement(child, triggerExtra as object);

  const tooltipBody =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={bodyRef}
            role="tooltip"
            id={tooltipId}
            data-testid={testId}
            className={`tooltip tooltip--${pos?.side ?? side}`}
            style={
              pos
                ? { left: `${pos.left}px`, top: `${pos.top}px` }
                : // Render offscreen on first paint so we can measure
                  // before final placement (avoids flash at 0,0).
                  { left: '-9999px', top: '-9999px' }
            }
          >
            {content}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {clonedTrigger}
      {tooltipBody}
    </>
  );
};
