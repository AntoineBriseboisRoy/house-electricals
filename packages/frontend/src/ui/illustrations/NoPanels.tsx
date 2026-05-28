import { forwardRef, type SVGProps } from 'react';

/**
 * Cycle-76 — "No panels yet" illustration.
 *
 * Sketch of an electrical panel: outer rectangle (the panel cabinet),
 * 6 horizontal breaker-slot rectangles inside, a sage accent stripe
 * along the top edge, and a small plus glyph hinting at "add one".
 *
 * Stroke: `currentColor` (inherits from .empty-state__illustration's
 * `color: var(--color-fg-muted)`). Accents: `var(--color-accent)` and
 * `var(--color-accent-subtle)`. NO hex literals (Lockin FATAL #3).
 */
export const NoPanels = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
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
      {/* Panel cabinet body */}
      <rect
        x={28}
        y={20}
        width={84}
        height={100}
        rx={4}
        fill="var(--color-accent-subtle)"
      />
      {/* Sage accent stripe — top of the panel (the brand) */}
      <line
        x1={28}
        y1={30}
        x2={112}
        y2={30}
        stroke="var(--color-accent)"
        strokeWidth={2.5}
      />
      {/* Breaker slot rectangles — 6 rows */}
      <rect x={38} y={42} width={28} height={8} rx={1.5} />
      <rect x={74} y={42} width={28} height={8} rx={1.5} />
      <rect x={38} y={58} width={28} height={8} rx={1.5} />
      <rect x={74} y={58} width={28} height={8} rx={1.5} />
      <rect x={38} y={74} width={28} height={8} rx={1.5} />
      <rect x={74} y={74} width={28} height={8} rx={1.5} />
      <rect x={38} y={90} width={28} height={8} rx={1.5} />
      <rect x={74} y={90} width={28} height={8} rx={1.5} />
      {/* Plus glyph — bottom-right hint */}
      <circle
        cx={104}
        cy={110}
        r={9}
        fill="var(--color-accent-subtle)"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
      />
      <line
        x1={104}
        y1={106}
        x2={104}
        y2={114}
        stroke="var(--color-accent)"
      />
      <line
        x1={100}
        y1={110}
        x2={108}
        y2={110}
        stroke="var(--color-accent)"
      />
    </svg>
  )
);

NoPanels.displayName = 'NoPanels';
