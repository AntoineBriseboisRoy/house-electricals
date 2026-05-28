import { forwardRef, useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Optional disabled flag — useful for placeholder rows. */
  disabled?: boolean;
};

/** Grouped options — renders as native `<optgroup>` blocks. Used by
 *  BreakerPicker for panel-grouped breaker lists. */
export type SelectOptGroup<T extends string> = {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
};

export type SelectProps<T extends string> = {
  /** Current value, or null when nothing is selected (renders the placeholder). */
  value: T | null;
  /** Change handler. Empty `<select>` value maps to null at this boundary
   *  so consumers don't repeat the cycle-42 G34 / cycle-68 G37 setValueAs
   *  dance at the call site. */
  onChange: (next: T | null) => void;
  /** Options to render — either a flat list or grouped via `<optgroup>`.
   *  Exactly one of `options` or `optGroups` must be provided. */
  options?: ReadonlyArray<SelectOption<T>>;
  /** Optgroup-rendered options (panel → breakers, etc.). */
  optGroups?: ReadonlyArray<SelectOptGroup<T>>;
  /** Placeholder row label. When provided, an empty-string option is
   *  prepended; selecting it resolves to null. When omitted, no placeholder
   *  row is rendered (use this when null is not a valid value AND every
   *  option is enumerated). */
  placeholder?: string;
  /** Visible label. Pass `null` to skip — you must then supply `aria-label`. */
  label?: ReactNode | null;
  /** Error message — when present, the select flips to the danger variant. */
  error?: string | null;
  /** Subtle hint shown under the field when no error is active. */
  hint?: string;
  disabled?: boolean;
  /** Accessible label when no visible label is present. */
  'aria-label'?: string;
  /** Data-testid forwarded to the native select element. */
  'data-testid'?: string;
  /** Native id attribute. Generated via useId when omitted. */
  id?: string;
  className?: string;
};

/**
 * Select primitive (cycle-71) — controlled API mirroring the cycle-50
 * Checkbox precedent. Generic over the string enum the consumer expects.
 *
 * Internal: native `<select>` wrapped in the same chrome as Input (label,
 * error, hint slots). A lucide `<ChevronDown>` is absolutely positioned
 * inside `.select__control` so it theme-tracks (no background-image SVG).
 *
 * Why controlled (and not register-spread):
 * - `setValueAs: (v) => v === 'gfci' ... ? v : null` boilerplate at every
 *   call site (cycle-42 G34, cycle-68 G37) is hoisted into `onChange` here.
 * - Cross-field effects (poles → tandemHalf nullify, panel → breaker
 *   clear) are easier to model when each select is controlled by
 *   `watch()` + `setValue()`.
 */
function SelectInner<T extends string>(
  {
    value,
    onChange,
    options,
    optGroups,
    placeholder,
    label,
    error,
    hint,
    disabled,
    'aria-label': ariaLabel,
    'data-testid': testId,
    id,
    className,
  }: SelectProps<T>,
  ref: React.ForwardedRef<HTMLSelectElement>
): JSX.Element {
  const reactId = useId();
  const selId = id ?? `sel-${reactId}`;
  const describedId = error
    ? `${selId}-err`
    : hint
      ? `${selId}-hint`
      : undefined;
  const wrapperClasses = [
    'select',
    error ? 'select--error' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      {label !== null && label !== undefined && (
        <label htmlFor={selId} className="select__label">
          {label}
        </label>
      )}
      <div className="select__control">
        <select
          ref={ref}
          id={selId}
          className="select__field"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange((v === '' ? null : (v as T)));
          }}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedId}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {placeholder !== undefined && (
            <option value="">{placeholder}</option>
          )}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {optGroups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="select__chevron" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={2} />
        </span>
      </div>
      {error ? (
        <p id={`${selId}-err`} className="select__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${selId}-hint`} className="select__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Cast to preserve generic signature through forwardRef.
export const Select = forwardRef(SelectInner) as <T extends string>(
  props: SelectProps<T> & { ref?: React.ForwardedRef<HTMLSelectElement> }
) => JSX.Element;
