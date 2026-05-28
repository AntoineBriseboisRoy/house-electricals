import type { JSX } from 'react';

/**
 * Checkbox primitive — G42(f) cycle-50.
 *
 * Thin wrapper over `<input type="checkbox">` with token-driven styling.
 * The native input stays in the DOM (and is screen-reader announced) but
 * is visually hidden; a styled `.checkbox__box` renders the visible square.
 *
 * Hit area: the entire `<label>` is the click target (>=44px via padding —
 * see `.checkbox` rules in styles.css, per CLAUDE.md G42(f) constraint).
 */

export type CheckboxProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Optional visible label rendered next to the box. */
  label?: string;
  /** Accessible name when no visible label is present (e.g. row checkboxes). */
  ariaLabel?: string;
  disabled?: boolean;
  /** Optional data-testid forwarded to the native input. */
  testId?: string;
};

export const Checkbox = ({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled,
  testId,
}: CheckboxProps): JSX.Element => (
  <label className={`checkbox${disabled ? ' checkbox--disabled' : ''}`}>
    <input
      type="checkbox"
      className="checkbox__input"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      data-testid={testId}
    />
    <span className="checkbox__box" aria-hidden="true">
      {checked && <span className="checkbox__check">✓</span>}
    </span>
    {label !== undefined && label !== '' && (
      <span className="checkbox__label">{label}</span>
    )}
  </label>
);
