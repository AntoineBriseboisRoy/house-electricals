import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Inline loading indicator primitive (cycle-74).
 *
 * Wraps lucide-react `Loader2` with a `role="status"` announcement region
 * and a visually-hidden screen-reader label. Used for non-Button surfaces
 * where a bare "Loading…" text label was previously used.
 *
 * Reduced-motion: the spinning animation is disabled via a CSS carve-out
 * inside `@media (prefers-reduced-motion: reduce)`. The icon still
 * renders — just statically — so the affordance is preserved.
 *
 * No default `data-testid` (per cycle-72 Card precedent — opt-in only).
 */
export type SpinnerProps = {
  /** Pixel size of the icon. Defaults to 16. */
  size?: number;
  /** Screen-reader label. Defaults to "Loading". */
  label?: string;
  /** Optional extra class names. */
  className?: string;
};

const cx = (...parts: Array<string | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ size = 16, label = 'Loading', className }, ref): JSX.Element => {
    return (
      <span
        ref={ref}
        className={cx('spinner', className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={size} aria-hidden="true" />
        <span className="visually-hidden">{label}</span>
      </span>
    );
  }
);

Spinner.displayName = 'Spinner';
