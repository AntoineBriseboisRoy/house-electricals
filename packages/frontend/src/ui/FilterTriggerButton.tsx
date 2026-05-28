import { forwardRef, type ReactNode } from 'react';
import { Filter, type LucideIcon } from 'lucide-react';

/**
 * Cycle-60: Ported from HousesTracker `client/src/components/ui/FilterTriggerButton.tsx`.
 *
 * Pill button used as the trigger for filter/sort popovers. Optional `count`
 * renders a circular badge. Token-driven via the `.filter-trigger-btn`
 * CSS class — no inline colors.
 */

export type FilterTriggerButtonProps = {
  onClick: () => void;
  active?: boolean;
  count?: number;
  label: ReactNode;
  icon?: LucideIcon;
  className?: string;
  ariaLabel?: string;
  /** Optional data-testid for e2e selectors. */
  testId?: string;
};

export const FilterTriggerButton = forwardRef<
  HTMLButtonElement,
  FilterTriggerButtonProps
>(function FilterTriggerButton(
  {
    onClick,
    active = false,
    count,
    label,
    icon: Icon = Filter,
    className,
    ariaLabel,
    testId,
  },
  ref
) {
  const classes = [
    'filter-trigger-btn',
    active ? 'filter-trigger-btn--active' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={classes}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <span className="filter-trigger-btn__icon" aria-hidden="true">
        <Icon size={14} strokeWidth={2.25} />
      </span>
      <span className="filter-trigger-btn__label">{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          className="filter-trigger-btn__count"
          data-testid="filter-trigger-btn-count"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
});

FilterTriggerButton.displayName = 'FilterTriggerButton';
