import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches the button to fill its container. */
  block?: boolean;
  /** Optional leading lucide icon. */
  leadingIcon?: ReactNode;
  /**
   * Cycle-74 — in-flight signal. When true, prepends a `Loader2` spinner
   * (BEFORE `leadingIcon`), sets `aria-busy="true"` + `data-busy="true"`,
   * and adds `.btn--busy`. Children + leadingIcon continue to render
   * (no layout jitter). Does NOT auto-disable — caller still owns the
   * `disabled` prop.
   */
  busy?: boolean;
};

/**
 * Button primitive. Token-driven; no inline styles allowed.
 *
 * - All variants meet 44px min-height (touch target).
 * - `sm` is for inline contexts (table rows) where the row itself meets 44px.
 * - `danger` is for destructive actions; pair with confirmation.
 * - `ghost` is for tertiary actions in toolbars / headers.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      block = false,
      leadingIcon,
      busy = false,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ): JSX.Element => {
    const classes = [
      'btn',
      `btn--${variant}`,
      `btn--${size}`,
      block ? 'btn--block' : null,
      busy ? 'btn--busy' : null,
      className,
    ]
      .filter(Boolean)
      .join(' ');
    // Cycle-74 — match icon size to the button size variant so the spinner
    // sits visually inline with the leadingIcon family used elsewhere.
    const iconSize = size === 'sm' ? 14 : 16;
    // Cycle-74 — accept-but-don't-override caller-supplied aria-busy /
    // data-busy. The defaults from `busy` win unless overridden by props.
    const busyProps = busy
      ? { 'aria-busy': true as const, 'data-busy': 'true' }
      : {};
    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        {...busyProps}
        {...rest}
      >
        {busy && (
          <Loader2
            size={iconSize}
            className="btn__spinner"
            aria-hidden="true"
          />
        )}
        {leadingIcon !== undefined && (
          <span className="btn__leading" aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        {/* G30 cycle-38 — children wrapped in a label span so CSS can
         *  visually-hide the text (e.g. in a ScreenHeader at mobile) while
         *  leaving the leadingIcon visible. Bare text nodes can't be
         *  CSS-targeted. */}
        <span className="btn__label">{children}</span>
      </button>
    );
  }
);

Button.displayName = 'Button';
