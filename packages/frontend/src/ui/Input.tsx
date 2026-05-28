import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** Visible label. Pass `null` to skip a visible label — you must then
   *  supply an `aria-label` attribute yourself. */
  label?: ReactNode | null;
  /** Error message shown under the field. When present, the input flips to
   *  the danger variant. */
  error?: string | null;
  /** Subtle hint shown under the field when no error is active. */
  hint?: string;
  /** Leading icon (lucide). */
  leadingIcon?: ReactNode;
};

/**
 * Input primitive. Wraps a native `<input>` with a label + optional
 * error/hint slot. Token-driven, no inline styles. 44px min height.
 *
 * Uses `useId()` to generate an id when none is supplied. Description ids
 * are also generated so screen readers announce error / hint via aria-describedby.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, hint, leadingIcon, id, className, ...rest },
    ref
  ): JSX.Element => {
    const reactId = useId();
    const inputId = id ?? `in-${reactId}`;
    const describedId = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
    const wrapperClasses = [
      'input',
      error ? 'input--error' : null,
      leadingIcon !== undefined ? 'input--with-leading' : null,
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={wrapperClasses}>
        {label !== null && label !== undefined && (
          <label htmlFor={inputId} className="input__label">
            {label}
          </label>
        )}
        <div className="input__control">
          {leadingIcon !== undefined && (
            <span className="input__leading" aria-hidden="true">
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className="input__field"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedId}
            {...rest}
          />
        </div>
        {error ? (
          <p id={`${inputId}-err`} className="input__error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId}-hint`} className="input__hint">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
