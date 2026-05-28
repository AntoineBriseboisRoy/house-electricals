import type { ReactNode } from 'react';

/**
 * EmptyState — list-empty placeholder primitive.
 *
 * Pass EITHER `icon` (lucide-react element) OR `illustration` (bespoke
 * SVG component from ui/illustrations/). Mutually exclusive; runtime
 * throws if both provided.
 *
 * Partition rule (cycle-76 + cycle-77 ADR):
 * - `illustration` slot is reserved for FIRST-IMPRESSION list-empty
 *   surfaces — the user arrived at this screen + section and the only
 *   reason it's empty is no data exists yet.
 * - Use `icon` (lucide) for:
 *   - filtered-empty branches (the user typed a filter that matched zero rows)
 *   - error states (e.g. "Floor not found")
 *   - selection placeholders ("Nothing selected")
 *   - mobile-hidden surfaces
 *
 * Adding a new EmptyState site? Pick the prop by asking "is this user's
 * FIRST encounter with an empty list-of-things on this screen?" If yes
 * → illustration. If no → icon.
 *
 * Example:
 *   <EmptyState
 *     icon={<LayoutGrid size={36} />}
 *     title="No panels match your filters"
 *     description="Clear the filters to see the full list."
 *     action={<Button onClick={...}>Clear filters</Button>}
 *   />
 *
 *   <EmptyState
 *     illustration={<NoPanels />}
 *     title="No panels yet"
 *     description="Add your first electrical panel to start mapping."
 *   />
 */
export type EmptyStateProps = {
  /** lucide icon (typically size 32-40, stroke 1.5). Mutually exclusive with `illustration`. */
  icon?: ReactNode;
  /** Bespoke SVG illustration (cycle-76). Mutually exclusive with `icon`. */
  illustration?: ReactNode;
  /** Headline (short, ~3-5 words). */
  title: string;
  /** One sentence explaining what the user can do next. */
  description?: string;
  /** Optional action button (use the Button primitive). */
  action?: ReactNode;
};

export const EmptyState = ({
  icon,
  illustration,
  title,
  description,
  action,
}: EmptyStateProps): JSX.Element => {
  if (icon === undefined && illustration === undefined) {
    // Runtime guard — one of icon|illustration must be provided. (TS makes
    // both optional for ergonomic call-sites; this catches misuse in dev.)
    throw new Error(
      'EmptyState: one of `icon` or `illustration` must be provided.'
    );
  }
  if (icon !== undefined && illustration !== undefined) {
    throw new Error(
      'EmptyState: `icon` and `illustration` are mutually exclusive — provide ONE.'
    );
  }
  return (
    <div className="empty-state" role="status">
      {illustration !== undefined ? (
        <div className="empty-state__illustration" aria-hidden="true">
          {illustration}
        </div>
      ) : (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="empty-state__title">{title}</h2>
      {description !== undefined && (
        <p className="empty-state__description">{description}</p>
      )}
      {action !== undefined && <div className="empty-state__action">{action}</div>}
    </div>
  );
};
