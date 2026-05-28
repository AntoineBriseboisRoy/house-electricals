import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
 * to centered automatically. The drag-handle inside the sheet is
 * DECORATIVE ONLY — NO pointer handlers, NO drag-to-dismiss gesture.
 * Dismissal is via Close button, overlay click, and ESC (unchanged).
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
  const modalClassName = isSheet ? 'modal modal--sheet' : 'modal';

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
        // Click inside the modal must not bubble to the overlay's close handler.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Cycle-73: decorative drag-handle at top of bottom-sheet — NO
            pointer handlers, NO drag-to-dismiss gesture (per Lockin
            FATAL #2 alternative). Visual cue for the sheet pattern. */}
        {isSheet && (
          <div className="modal__drag-handle" aria-hidden="true" />
        )}
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">{title}</h2>
          {showCloseButton && (
            <IconButton
              icon={<X size={18} strokeWidth={2.25} />}
              aria-label="Close"
              variant="ghost"
              onClick={onClose}
            />
          )}
        </header>
        <div className="modal__body">{children}</div>
        {footer !== undefined && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
};
