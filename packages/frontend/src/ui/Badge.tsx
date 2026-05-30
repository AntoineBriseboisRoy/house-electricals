import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Badge primitive (G47) — a small inline pill for counts, statuses, and
 * flags.
 *
 * Formalizes the long-standing `<span className="badge badge--{tone}">…`
 * markup that was hand-rolled across BreakerWithComponents, ComponentsScreen,
 * TestPanelScreen, and ImpactModal. Renders the SAME DOM (a `<span>` with the
 * `badge` + `badge--{tone}` classes) so the rendered output is byte-identical
 * to the inline form — this is a documentation/consolidation primitive, NOT a
 * restyle. All visuals come from the existing `.badge` / `.badge--*` rules in
 * styles.css (token-driven).
 *
 * Tones map 1:1 to the existing modifier classes:
 *   - `count`   → `.badge--count`   (accent-subtle — neutral counts/info)
 *   - `warn`    → `.badge--warn`    (danger-subtle — "Unassigned", "Currently off")
 *   - `critical`→ `.badge--critical`(warning amber — the components.critical flag)
 *   - `protection`→ `.badge--protection` (warning amber — GFCI/AFCI; see
 *                   the domain `<ProtectionBadge>` wrapper which sets the
 *                   data-protection contract on top of this tone)
 *
 * `...rest` is spread onto the `<span>` so callers can pass `data-testid`,
 * `tabIndex`, `title`, etc. exactly as they did inline. Extra layout classes
 * (e.g. `breaker-row__count`) pass through `className`.
 */
export type BadgeTone = 'count' | 'warn' | 'critical' | 'protection';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** Visual tone — maps to the `.badge--{tone}` modifier class. Default 'count'. */
  tone?: BadgeTone;
  children: ReactNode;
};

export const Badge = ({
  tone = 'count',
  className,
  children,
  ...rest
}: BadgeProps): JSX.Element => {
  const classes = ['badge', `badge--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
};
