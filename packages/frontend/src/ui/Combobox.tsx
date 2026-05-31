import {
  useCallback,
  useEffect,
  useId,
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

/** Grouped options — renders a non-selectable header above each group's
 *  options (e.g. panel → breakers). Mutually exclusive with `options`. */
export type ComboboxOptGroup<T> = {
  label: string;
  options: readonly ComboboxOption<T>[];
};

export type ComboboxProps<T> = {
  value: T | null;
  onChange: (next: T | null) => void;
  /** Flat option list. Provide exactly one of `options` or `optGroups`. */
  options?: readonly ComboboxOption<T>[];
  /** Grouped options (rendered with headers). */
  optGroups?: readonly ComboboxOptGroup<T>[];
  /** Visible field label. When set, the combobox renders the same
   *  label/error/hint chrome as Input/Select. */
  label?: ReactNode;
  /** Error message — renders below the field with role="alert". */
  error?: string | null;
  /** Subtle hint shown below the field when no error is active. */
  hint?: string;
  /** Placeholder shown (muted) when no value is selected AND `noneLabel` is
   *  not set — i.e. for required fields where "empty" means "unfilled". */
  placeholder?: string;
  /**
   * When set, `null` is a first-class selectable value rather than an
   * "unfilled" state. The empty state renders this label in NORMAL text (not
   * muted placeholder), no `×` clear button appears, and a "None" row is
   * offered in the list. Use for optional enums (e.g. Protection → "None")
   * so they look identical to required dropdowns (e.g. Poles).
   */
  noneLabel?: string;
  ariaLabel?: string;
  /** When true (default), shows a small X clear button when a value is
   *  selected. Ignored when `noneLabel` is set (the None row clears instead). */
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
  /**
   * Whether to render the typeahead search box. When omitted, it auto-decides:
   * search shows only when there are enough options to warrant it
   * (> {@link SEARCH_AUTO_THRESHOLD}). Pass `false` to force a plain themed
   * dropdown (small fixed enums), or `true` to always show search.
   */
  searchable?: boolean;
};

/** Above this many options, the search box auto-appears. */
const SEARCH_AUTO_THRESHOLD = 7;

const defaultEquals = <T,>(a: T, b: T): boolean => a === b;

export function Combobox<T>({
  value,
  onChange,
  options,
  optGroups,
  label,
  error,
  hint,
  placeholder = 'Select…',
  noneLabel,
  ariaLabel,
  allowClear = true,
  className,
  testId,
  emptyMessage = 'No results',
  equals = defaultEquals,
  id,
  disabled = false,
  searchable,
}: ComboboxProps<T>): JSX.Element {
  const reactId = useId();
  const triggerId = id ?? `combobox-${reactId}`;
  // Flatten grouped options for filtering, keyboard nav + selected-label lookup.
  const baseOptions = useMemo<readonly ComboboxOption<T>[]>(
    () => (optGroups ? optGroups.flatMap((g) => g.options) : (options ?? [])),
    [optGroups, options]
  );
  const showSearch = searchable ?? baseOptions.length > SEARCH_AUTO_THRESHOLD;
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

  // On open, focus the search input when present, else the options list so
  // keyboard nav still works for the no-search ("normal dropdown") variant.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      if (showSearch) searchRef.current?.focus();
      else listRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, showSearch]);

  const filtered = useMemo(() => {
    if (!search) return baseOptions;
    const lower = search.toLowerCase();
    return baseOptions.filter((o) => o.label.toLowerCase().includes(lower));
  }, [baseOptions, search]);

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
    const match = baseOptions.find((o) => equals(o.value, value));
    return match?.label ?? null;
  }, [value, baseOptions, equals]);

  const wrapperClasses = ['combobox', className].filter(Boolean).join(' ');
  // When a value is set the trigger is described by its visible label; the
  // a11y name still comes from `ariaLabel`/`label` wiring.

  // Render a single option button at its flat index `i` (aligns with the
  // keyboard hook's `filtered` order, flat OR grouped).
  const renderOption = (option: ComboboxOption<T>, i: number): JSX.Element => {
    const isSelected = value !== null && equals(option.value, value);
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
        key={
          typeof option.value === 'string' || typeof option.value === 'number'
            ? `${String(option.value)}-${i}`
            : i
        }
        type="button"
        role="option"
        aria-selected={isSelected}
        data-combobox-item
        data-testid="combobox-option"
        data-value={
          typeof option.value === 'string' || typeof option.value === 'number'
            ? String(option.value)
            : undefined
        }
        onClick={() => !option.disabled && selectAndClose(option.value)}
        onMouseEnter={() => !option.disabled && setHighlightedIndex(i)}
        className={optClasses}
        disabled={option.disabled}
      >
        {option.label}
      </button>
    );
  };

  const field = (
    <div
      ref={containerRef}
      className={wrapperClasses}
      onKeyDown={handleKeyDown}
      data-testid={testId}
    >
      <button
        ref={triggerRef}
        id={triggerId}
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
            selectedLabel || noneLabel !== undefined
              ? 'combobox__value'
              : 'combobox__value combobox__value--placeholder'
          }
        >
          {selectedLabel ?? (noneLabel !== undefined ? noneLabel : placeholder)}
        </span>
        <span className="combobox__trigger-icons">
          {allowClear &&
            noneLabel === undefined &&
            value !== null &&
            !disabled && (
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
            {showSearch && (
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
            )}
            <div
              ref={(node) => {
                // listRef.current can be null per React's strict ref typing;
                // use a callback ref to bridge the wider RefObject<T | null>.
                (listRef as { current: HTMLDivElement | null }).current = node;
              }}
              className="combobox__options"
              role="listbox"
              tabIndex={-1}
              onKeyDown={!showSearch ? handleKeyDown : undefined}
            >
              {/* "None" row — when null is a first-class value. Mouse/tap
                  selectable (kept out of the keyboard list for small enums). */}
              {noneLabel !== undefined && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  data-testid="combobox-option"
                  data-value=""
                  className={[
                    'combobox__option',
                    value === null ? 'combobox__option--selected' : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectAndClose(null)}
                >
                  {noneLabel}
                </button>
              )}
              {filtered.length === 0 ? (
                noneLabel === undefined ? (
                  <div className="combobox__empty">{emptyMessage}</div>
                ) : null
              ) : optGroups ? (
                // Grouped render: a running flat index mirrors `filtered`
                // (groups in order → filtered options within each).
                (() => {
                  const lower = search.toLowerCase();
                  let flatIdx = -1;
                  return optGroups.map((group) => {
                    const groupOpts = search
                      ? group.options.filter((o) =>
                          o.label.toLowerCase().includes(lower)
                        )
                      : group.options;
                    if (groupOpts.length === 0) return null;
                    return (
                      <div className="combobox__group" key={group.label}>
                        <div
                          className="combobox__group-label"
                          role="presentation"
                        >
                          {group.label}
                        </div>
                        {groupOpts.map((option) => {
                          flatIdx += 1;
                          return renderOption(option, flatIdx);
                        })}
                      </div>
                    );
                  });
                })()
              ) : (
                filtered.map((option, i) => renderOption(option, i))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );

  if (label == null && error == null && hint == null) return field;

  return (
    <div className="combobox-field">
      {label != null && (
        <label htmlFor={triggerId} className="input__label">
          {label}
        </label>
      )}
      {field}
      {error ? (
        <p className="input__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="input__hint">{hint}</p>
      ) : null}
    </div>
  );
}
