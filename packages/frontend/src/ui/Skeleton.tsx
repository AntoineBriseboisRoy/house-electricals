import type { CSSProperties } from 'react';

/**
 * Shimmer placeholder for loading content.
 *
 * Variants:
 *   - `row`  — a single line of text-height (used in list rows)
 *   - `card` — a stacked block (title + a couple lines) that fills its parent
 *   - `bar`  — a generic bar; pass `width` / `height` to taste
 *
 * Honours prefers-reduced-motion via the token system (animation duration
 * collapses to 0ms).
 */
export type SkeletonProps = {
  variant?: 'row' | 'card' | 'bar';
  /** For `bar` variant — explicit dimensions. */
  width?: number | string;
  height?: number | string;
  /** Used by lists/tests to render multiple skeleton rows. */
  count?: number;
  /** Optional aria label for the loading region (defaults set per-variant). */
  'aria-label'?: string;
};

export const Skeleton = ({
  variant = 'row',
  width,
  height,
  count = 1,
  'aria-label': ariaLabel,
}: SkeletonProps): JSX.Element => {
  if (variant === 'card') {
    return (
      <div className="skeleton-card" role="status" aria-label={ariaLabel ?? 'Loading'}>
        <span className="skeleton-card__title shimmer" />
        <span className="skeleton-card__line shimmer" />
        <span className="skeleton-card__line shimmer skeleton-card__line--short" />
      </div>
    );
  }

  if (variant === 'bar') {
    const style: CSSProperties = {};
    if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height;
    return (
      <span
        className="skeleton-bar shimmer"
        role="status"
        aria-label={ariaLabel ?? 'Loading'}
        style={Object.keys(style).length > 0 ? style : undefined}
      />
    );
  }

  // row (default) — repeated count times
  const rows = Array.from({ length: Math.max(1, count) });
  return (
    <div className="skeleton-rows" role="status" aria-label={ariaLabel ?? 'Loading'}>
      {rows.map((_, i) => (
        <span key={i} className="skeleton-row shimmer" />
      ))}
    </div>
  );
};
