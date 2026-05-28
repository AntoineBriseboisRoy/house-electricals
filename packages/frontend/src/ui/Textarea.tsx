import {
  forwardRef,
  useId,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Visible label. Pass `null` to skip a visible label — you must then
   *  supply an `aria-label` attribute yourself. */
  label?: ReactNode | null;
  /** Error message shown under the field. When present, the textarea flips
   *  to the danger variant. */
  error?: string | null;
  /** Subtle hint shown under the field when no error is active. */
  hint?: string;
};

/**
 * Textarea primitive (cycle-71) — mirrors `Input.tsx` for multi-line text.
 *
 * Forwards `...rest` so `{...register('note')}` works for RHF spread, same
 * as Input. `rows` defaults to 4 (matches typical textarea sizing).
 *
 * Uses `useId()` to generate an id when none is supplied. Description ids
 * are also generated so screen readers announce error / hint via
 * aria-describedby.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { label, error, hint, id, className, rows = 4, ...rest },
    ref
  ): JSX.Element => {
    const reactId = useId();
    const taId = id ?? `ta-${reactId}`;
    const describedId = error ? `${taId}-err` : hint ? `${taId}-hint` : undefined;
    const wrapperClasses = [
      'textarea',
      error ? 'textarea--error' : null,
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={wrapperClasses}>
        {label !== null && label !== undefined && (
          <label htmlFor={taId} className="textarea__label">
            {label}
          </label>
        )}
        <div className="textarea__control">
          <textarea
            ref={ref}
            id={taId}
            className="textarea__field"
            rows={rows}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedId}
            {...rest}
          />
        </div>
        {error ? (
          <p id={`${taId}-err`} className="textarea__error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${taId}-hint`} className="textarea__hint">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
