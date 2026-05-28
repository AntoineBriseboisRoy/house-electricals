import { forwardRef, type SVGProps } from 'react';

/**
 * Cycle-76 — "No components yet" illustration.
 *
 * Sketch of a wall with three component glyphs: an outlet (square with
 * two slits), a pendant light (circle hanging from a line), and a wall
 * switch (rounded rectangle with a toggle). The pendant light is sage-
 * accented as the focal point.
 *
 * Stroke: `currentColor`. Accents: `var(--color-accent)` +
 * `var(--color-accent-subtle)`. NO hex literals.
 */
export const NoComponents = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
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
      {/* Wall/floor baseline */}
      <line x1={16} y1={118} x2={124} y2={118} />
      <line x1={16} y1={26} x2={124} y2={26} strokeDasharray="2 4" />

      {/* Pendant light — ceiling cord + bulb (sage accent — focal) */}
      <line
        x1={70}
        y1={26}
        x2={70}
        y2={50}
        stroke="var(--color-accent)"
        strokeWidth={1.5}
      />
      <circle
        cx={70}
        cy={60}
        r={11}
        fill="var(--color-accent-subtle)"
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
      {/* light rays */}
      <line
        x1={70}
        y1={76}
        x2={70}
        y2={82}
        stroke="var(--color-accent)"
      />
      <line
        x1={58}
        y1={72}
        x2={54}
        y2={76}
        stroke="var(--color-accent)"
      />
      <line
        x1={82}
        y1={72}
        x2={86}
        y2={76}
        stroke="var(--color-accent)"
      />

      {/* Outlet — left, on the wall */}
      <rect x={24} y={92} width={20} height={22} rx={2} />
      <line x1={31} y1={98} x2={31} y2={104} />
      <line x1={37} y1={98} x2={37} y2={104} />
      <circle cx={34} cy={108} r={1.2} fill="currentColor" />

      {/* Switch — right, on the wall */}
      <rect x={96} y={92} width={20} height={22} rx={2} />
      <rect x={102} y={97} width={8} height={6} rx={1.5} />
      <line x1={106} y1={103} x2={106} y2={108} />
    </svg>
  )
);

NoComponents.displayName = 'NoComponents';
