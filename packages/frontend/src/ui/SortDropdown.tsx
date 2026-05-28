import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { FilterTriggerButton } from './FilterTriggerButton.js';

/**
 * Cycle-60: Ported from HousesTracker `client/src/components/filters/SortDropdown.tsx`.
 *
 * Absolute-positioned sort menu. Trigger uses `FilterTriggerButton` (no
 * count badge — sort is always single-value). Token-driven via the
 * `.sort-dropdown` CSS class.
 */

export type SortOption<TBy extends string = string> = {
  sortBy: TBy;
  sortOrder: 'asc' | 'desc';
  label: string;
};

export type SortDropdownProps<TBy extends string = string> = {
  options: readonly SortOption<TBy>[];
  currentSortBy: TBy;
  currentSortOrder: 'asc' | 'desc';
  onSort: (sortBy: TBy, sortOrder: 'asc' | 'desc') => void;
  ariaLabel?: string;
  testId?: string;
};

export function SortDropdown<TBy extends string = string>({
  options,
  currentSortBy,
  currentSortOrder,
  onSort,
  ariaLabel = 'Sort',
  testId,
}: SortDropdownProps<TBy>): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current =
    options.find(
      (o) => o.sortBy === currentSortBy && o.sortOrder === currentSortOrder
    ) ??
    options.find((o) => o.sortBy === currentSortBy) ??
    options[0];

  return (
    <div ref={ref} className="sort-dropdown" data-testid={testId}>
      <FilterTriggerButton
        onClick={() => setOpen((v) => !v)}
        label={current?.label ?? 'Sort'}
        icon={SlidersHorizontal}
        ariaLabel={ariaLabel}
        testId={testId ? `${testId}-trigger` : 'sort-dropdown-trigger'}
      />
      {open && (
        <ul
          className="sort-dropdown__menu"
          role="listbox"
          data-testid={testId ? `${testId}-menu` : 'sort-dropdown-menu'}
        >
          {options.map((opt) => {
            const active =
              opt.sortBy === currentSortBy && opt.sortOrder === currentSortOrder;
            return (
              <li key={`${opt.sortBy}-${opt.sortOrder}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSort(opt.sortBy, opt.sortOrder);
                    setOpen(false);
                  }}
                  className={
                    active
                      ? 'sort-dropdown__option sort-dropdown__option--active'
                      : 'sort-dropdown__option'
                  }
                  data-testid="sort-dropdown-option"
                  data-sort-by={opt.sortBy}
                  data-sort-order={opt.sortOrder}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
