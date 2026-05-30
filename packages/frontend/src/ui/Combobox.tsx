import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { useComboboxKeyboard } from '../hooks/useComboboxKeyboard.js';
import { usePopoverPosition } from '../hooks/usePopoverPosition.js';

/**
 * Cycle-60: Generic single-select typeahead combobox.
 *
 * Lifted from HousesTracker `Dropdown.tsx` + `MunicipalitySelect.tsx` and
 * generalized to take any value type T. Multi-select is OUT OF SCOPE this
 * cycle — when needed, widen the API to `value: T[] | T | null` and add
 * a `multi?: true` flag.
 *
 * Behavior:
 *  - Click trigger → open a portal-mounted listbox flipped up/down based on
 *    available viewport space.
 *  - Type to filter (case-insensitive `.includes()` on `label`).
 *  - Keyboard nav via useComboboxKeyboard (ArrowUp/Down/Enter/Escape).
 *  - Listbox carries `data-portal-popover` so a parent FilterPopover doesn't
 *    interpret listbox clicks as outside-clicks.
 *
 * Tokens used: --color-bg-surface-raised, --color-border-strong, --shadow-lg,
 * --radius-md, --color-bg-hover, --color-accent-subtle, --color-accent.
 */

export type ComboboxOption<T> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type ComboboxProps<T> = {
  value: T | null;
  onChange: (next: T | null) => void;
  options: readonly ComboboxOption<T>[];
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  ariaLabel?: string;
  /** When true (default), shows a small X clear button when a value is selected. */
  allowClear?: boolean;
  /** Class name passed to the root wrapper. */
  className?: string;
  /** Optional data-testid for e2e selectors. */
  testId?: string;
  /** Text shown when filtered list is empty. */
  emptyMessage?: string;
  /** Compares two values for equality. Default: `===`. */
  equals?: (a: T, b: T) => boolean;
  /** Optional id passed to the trigger (for label/htmlFor). */
  id?: string;
  /** Disable the whole combobox. */
  disabled?: boolean;
};

const defaultEquals = <T,>(a: T, b: T): boolean => a === b;

export function Combobox<T>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  ariaLabel,
  allowClear = true,
  className,
  testId,
  emptyMessage = 'No results',
  equals = defaultEquals,
  id,
  disabled = false,
}: ComboboxProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Shared positioner (2026-05) — flips up/down + viewport-clamps; re-anchors
  // on scroll/resize so it tracks inside an overflow-auto FilterPopover.
  const pos = usePopoverPosition({ isOpen, triggerRef });

  // Outside-click closes the listbox. The portalled list lives outside
  // containerRef so we check dropdownRef explicitly.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
      setSearch('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Focus the search input on open.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  const selectAndClose = useCallback(
    (val: T | null) => {
      onChange(val);
      setIsOpen(false);
      setSearch('');
    },
    [onChange]
  );

  const closeAndReset = useCallback((): void => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const { highlightedIndex, setHighlightedIndex, onKeyDown, listRef } =
    useComboboxKeyboard<ComboboxOption<T>>({
      items: [...filtered],
      isOpen,
      onSelect: (item) => selectAndClose(item.value),
      onClose: closeAndReset,
      isItemDisabled: (item) => Boolean(item.disabled),
    });

  // When closed, Down/Enter/Space opens the menu.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (disabled) return;
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }
      onKeyDown(e);
    },
    [isOpen, onKeyDown, disabled]
  );

  const selectedLabel: ReactNode = useMemo(() => {
    if (value === null) return null;
    const match = options.find((o) => equals(o.value, value));
    return match?.label ?? null;
  }, [value, options, equals]);

  const wrapperClasses = ['combobox', className].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      className={wrapperClasses}
      onKeyDown={handleKeyDown}
      data-testid={testId}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen((o) => !o);
          setSearch('');
        }}
        className="combobox__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <span
          className={
            selectedLabel
              ? 'combobox__value'
              : 'combobox__value combobox__value--placeholder'
          }
        >
          {selectedLabel ?? placeholder}
        </span>
        <span className="combobox__trigger-icons">
          {allowClear && value !== null && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setIsOpen(false);
              }}
              className="combobox__clear"
              aria-label="Clear selection"
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <X size={12} strokeWidth={2.25} />
            </span>
          )}
          <ChevronDown
            size={14}
            strokeWidth={2.25}
            className={
              isOpen
                ? 'combobox__chevron combobox__chevron--open'
                : 'combobox__chevron'
            }
          />
        </span>
      </button>

      {isOpen &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            data-portal-popover="true"
            data-testid={testId ? `${testId}-listbox` : 'combobox-listbox'}
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 9999,
            }}
            className="combobox__listbox"
          >
            <div className="combobox__search-wrap">
              <span className="combobox__search-icon" aria-hidden="true">
                <Search size={12} strokeWidth={2.25} />
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="combobox__search"
                aria-label="Search options"
                onKeyDown={handleKeyDown}
              />
            </div>
            <div
              ref={(node) => {
                // listRef.current can be null per React's strict ref typing;
                // use a callback ref to bridge the wider RefObject<T | null>.
                (listRef as { current: HTMLDivElement | null }).current = node;
              }}
              className="combobox__options"
              role="listbox"
            >
              {filtered.length === 0 ? (
                <div className="combobox__empty">{emptyMessage}</div>
              ) : (
                filtered.map((option, i) => {
                  const isSelected =
                    value !== null && equals(option.value, value);
                  const isHighlighted = i === highlightedIndex;
                  const optClasses = [
                    'combobox__option',
                    isHighlighted ? 'combobox__option--active' : null,
                    isSelected ? 'combobox__option--selected' : null,
                    option.disabled ? 'combobox__option--disabled' : null,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <button
                      key={i}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-combobox-item
                      data-testid="combobox-option"
                      data-value={
                        typeof option.value === 'string' ||
                        typeof option.value === 'number'
                          ? String(option.value)
                          : undefined
                      }
                      onClick={() =>
                        !option.disabled && selectAndClose(option.value)
                      }
                      onMouseEnter={() =>
                        !option.disabled && setHighlightedIndex(i)
                      }
                      className={optClasses}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
