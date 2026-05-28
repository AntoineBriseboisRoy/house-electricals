import { forwardRef, type SVGProps } from 'react';

/**
 * Cycle-76 — "No breakers yet" illustration.
 *
 * Sketch of a single breaker column inside a thin cabinet outline:
 * 5 horizontal slot rectangles stacked vertically. The second-from-top
 * slot is sage-accented (the "first one you'll add" hint).
 *
 * Stroke: `currentColor`. Accents: `var(--color-accent)` +
 * `var(--color-accent-subtle)`. NO hex literals.
 */
export const NoBreakers = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  (props, ref): JSX.Element => (
    <svg
      ref={ref}
      viewBox="0 0 140 140"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Cabinet outline */}
      <rect x={46} y={18} width={48} height={104} rx={3} />
      {/* Top label band */}
      <line
        x1={46}
        y1={28}
        x2={94}
        y2={28}
        stroke="var(--color-accent)"
        strokeWidth={2}
      />

      {/* 6 breaker slot rectangles */}
      <rect x={54} y={36} width={32} height={10} rx={1.5} />
      <rect
        x={54}
        y={50}
        width={32}
        height={10}
        rx={1.5}
        fill="var(--color-accent-subtle)"
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
      {/* tiny breaker toggle hint on the accented slot */}
      <rect
        x={66}
        y={53}
        width={8}
        height={4}
        rx={1}
        fill="var(--color-accent)"
        stroke="var(--color-accent)"
      />
      <rect x={54} y={64} width={32} height={10} rx={1.5} />
      <rect x={54} y={78} width={32} height={10} rx={1.5} />
      <rect x={54} y={92} width={32} height={10} rx={1.5} />
      <rect x={54} y={106} width={32} height={10} rx={1.5} />
    </svg>
  )
);

NoBreakers.displayName = 'NoBreakers';
