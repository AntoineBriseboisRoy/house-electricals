import { forwardRef, type SVGProps } from 'react';

/**
 * Cycle-76 — "No floors yet" illustration.
 *
 * Sketch of a stacked floor plan: 3 layered rectangles representing
 * floors with slight perspective offset (top floor smallest, ground
 * floor largest). The top layer gets the sage accent — "your new
 * floor goes here".
 *
 * Stroke: `currentColor`. Accents: `var(--color-accent)` +
 * `var(--color-accent-subtle)`. NO hex literals.
 */
export const NoFloors = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
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
      {/* Bottom floor (ground) — largest, neutral */}
      <rect x={24} y={84} width={92} height={32} rx={3} />
      {/* A door + window hint on the ground floor */}
      <rect x={36} y={94} width={8} height={16} rx={1} />
      <rect x={56} y={94} width={12} height={10} rx={1} />
      <rect x={84} y={94} width={12} height={10} rx={1} />

      {/* Middle floor */}
      <rect x={30} y={54} width={80} height={28} rx={3} />
      <rect x={42} y={62} width={10} height={12} rx={1} />
      <rect x={64} y={62} width={10} height={12} rx={1} />
      <rect x={86} y={62} width={10} height={12} rx={1} />

      {/* Top floor — sage-accented (the new one) */}
      <rect
        x={36}
        y={26}
        width={68}
        height={26}
        rx={3}
        fill="var(--color-accent-subtle)"
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
      <rect
        x={48}
        y={34}
        width={10}
        height={12}
        rx={1}
        stroke="var(--color-accent)"
      />
      <rect
        x={82}
        y={34}
        width={10}
        height={12}
        rx={1}
        stroke="var(--color-accent)"
      />
    </svg>
  )
);

NoFloors.displayName = 'NoFloors';
