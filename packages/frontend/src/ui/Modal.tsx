import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton.js';

/**
 * Base Modal primitive (G20).
 *
 * Token-driven. ESC closes; overlay click closes (configurable); a basic
 * focus trap focuses the first interactive element on open and restores
 * focus to the previously-focused element on close.
 *
 * Higher-level dialogs (ConfirmModal, PromptModal, PickerModal) wrap this.
 * Most callers should use the `useModal` hook for imperative ergonomics
 * rather than rendering Modal directly.
 *
 * Cycle-73: `presentation` opt-in. Default `'centered'` is byte-identical
 * to cycle-20 G20 behavior. `'sheet'` pivots to a bottom-anchored sheet
 * below 720px viewport (matchMedia); above 720px the sheet falls back
 * to centered automatically.
 *
 * 2026-05 (user feedback): the sheet's drag-handle is now FUNCTIONAL —
 * grab it and swipe down to dismiss (the sheet follows the finger; release
 * past ~30% of its height, or ~150px, closes; otherwise it snaps back).
 * This supersedes the cycle-73 "decorative only" decision. Close button,
 * overlay click, and ESC still work as before.
 */

/** Cycle-73: narrow-viewport media-query hook (mirrors the cycle-36 G29
 *  pattern in PanelVisualization.tsx). 720px is the canonical mobile-
 *  fold breakpoint (intentionally tighter than the 960px desktop pivot). */
const useNarrowViewport = (): boolean => {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 719px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 719px)');
    const handler = (e: MediaQueryListEvent): void => setNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return narrow;
};

export type ModalPresentation = 'centered' | 'sheet';

export type ModalProps = {
  /** Open state — when false the Modal renders null (no DOM). */
  open: boolean;
  /** Called when user dismisses via ESC, overlay click, or the X button. */
  onClose: () => void;
  /** Header title — short. */
  title: string;
  /** Body content. */
  children: ReactNode;
  /** Footer actions (typically <Button>s). */
  footer?: ReactNode;
  /** Optional action rendered in the header top-right, before the X (e.g. an
   *  "Add" button). 2026-05. */
  headerAction?: ReactNode;
  /** When true (default), clicking the dimmed overlay closes the modal. */
  closeOnOverlay?: boolean;
  /** When true, render an X icon in the top-right corner. Default true. */
  showCloseButton?: boolean;
  /** ARIA labelledby/describedby ids — both auto-generated if omitted. */
  ariaLabel?: string;
  /** Optional data-testid on the dialog root for e2e selectors. */
  testId?: string;
  /** Cycle-73: visual presentation. Defaults to `'centered'` (byte-
   *  identical to cycle-20 G20 behavior). `'sheet'` pivots to a bottom-
   *  anchored sheet below 720px viewport; falls back to centered above. */
  presentation?: ModalPresentation;
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  headerAction,
  closeOnOverlay = true,
  showCloseButton = true,
  ariaLabel,
  testId,
  presentation = 'centered',
}: ModalProps): JSX.Element | null => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const narrow = useNarrowViewport();
  // Sheet variant only pivots below 720px. Above the breakpoint, fall
  // back to centered visuals so desktop renders match cycle-20 G20.
  const isSheet = presentation === 'sheet' && narrow;

  // --- Sheet drag-to-dismiss (mobile) -----------------------------------
  // Grab the handle and swipe down: the sheet follows the finger (downward
  // only); releasing past a threshold closes, otherwise it snaps back. PATCH
  // of state is local; pointer capture keeps the gesture even if the finger
  // leaves the handle. Reset whenever the modal closes so a reopen starts
  // flush.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setDragging(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!isSheet) return;
      dragStartRef.current = { y: e.clientY, pointerId: e.pointerId };
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // some browsers reject setPointerCapture; ignore
      }
    },
    [isSheet]
  );

  const onHandlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const st = dragStartRef.current;
      if (st === null) return;
      const dy = e.clientY - st.y;
      setDragY(dy > 0 ? dy : 0); // downward only
    },
    []
  );

  const onHandlePointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const st = dragStartRef.current;
      if (st === null) return;
      dragStartRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(st.pointerId);
      } catch {
        // ignore
      }
      const dy = e.clientY - st.y;
      const sheetH = dialogRef.current?.offsetHeight ?? 400;
      const threshold = Math.min(150, sheetH * 0.3);
      if (dy > threshold) {
        onClose();
      } else {
        setDragY(0); // snap back
      }
    },
    [onClose]
  );

  // Capture/restore focus on open/close.
  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer to next tick so the dialog content has mounted.
    const t = window.setTimeout(() => {
      const node = dialogRef.current;
      if (!node) return;
      const focusable = node.querySelector<HTMLElement>(
        'input,textarea,select,button,[href],[tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      lastFocusedRef.current?.focus?.();
    };
  }, [open]);

  // Lock body scroll while a modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  const handleOverlayClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      if (!closeOnOverlay) return;
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlay, onClose]
  );

  if (!open) return null;

  const overlayClassName = isSheet
    ? 'modal-overlay modal-overlay--sheet'
    : 'modal-overlay';
  const modalClassName = isSheet
    ? 'modal modal--sheet' + (dragging ? ' modal--sheet-dragging' : '')
    : 'modal';
  // Follow-the-finger transform while the sheet is being dragged down.
  const dialogStyle: CSSProperties | undefined =
    isSheet && dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined;

  return (
    <div
      className={overlayClassName}
      role="presentation"
      onMouseDown={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        data-testid={testId ?? 'modal'}
        className={modalClassName}
        style={dialogStyle}
        // Click inside the modal must not bubble to the overlay's close handler.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Bottom-sheet drag-handle — swipe down to dismiss (2026-05). The
            visible bar is the ::before; the element itself is a taller touch
            zone. ESC + Close button + overlay click remain the accessible
            dismiss paths, so the handle stays aria-hidden. */}
        {isSheet && (
          <div
            className="modal__drag-handle"
            aria-hidden="true"
            data-testid="modal-drag-handle"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerEnd}
            onPointerCancel={onHandlePointerEnd}
          />
        )}
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">{title}</h2>
          <div className="modal__header-actions">
            {headerAction}
            {showCloseButton && (
              <IconButton
                icon={<X size={18} strokeWidth={2.25} />}
                aria-label="Close"
                variant="ghost"
                onClick={onClose}
              />
            )}
          </div>
        </header>
        <div className="modal__body">{children}</div>
        {footer !== undefined && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
};
