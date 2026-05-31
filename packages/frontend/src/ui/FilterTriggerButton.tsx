import { forwardRef, type ReactNode } from 'react';
import { Filter, X, type LucideIcon } from 'lucide-react';

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
  /** When provided AND `active`, an inline × clear renders inside the pill
   *  (right edge). Clicking it calls onClear without toggling the popover. */
  onClear?: () => void;
  clearAriaLabel?: string;
  clearTestId?: string;
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
    onClear,
    clearAriaLabel = 'Clear',
    clearTestId,
  },
  ref
) {
  const showClear = onClear !== undefined && active;
  const classes = [
    'filter-trigger-btn',
    active ? 'filter-trigger-btn--active' : null,
    showClear ? 'filter-trigger-btn--clearable' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
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
    </>
  );

  // No clear → a single button (unchanged). With clear → a pill wrapper
  // holding the open button + a sibling × button (valid HTML: no nested
  // interactive elements). The ref anchors the popover to the open part.
  if (showClear) {
    return (
      <span className={classes}>
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="filter-trigger-btn__open"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {inner}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="filter-trigger-btn__clear"
          aria-label={clearAriaLabel}
          data-testid={clearTestId}
        >
          <X size={13} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={classes}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {inner}
    </button>
  );
});

FilterTriggerButton.displayName = 'FilterTriggerButton';
