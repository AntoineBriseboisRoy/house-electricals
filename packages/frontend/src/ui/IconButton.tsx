import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type IconButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** lucide-react icon node (~20-22px). */
  icon: ReactNode;
  /** Required: accessible label since the button has no visible text. */
  'aria-label': string;
  variant?: IconButtonVariant;
};

/**
 * Square icon-only button. 44x44 min hit target.
 *
 * `aria-label` is required by the type — TS will flag any usage that omits
 * the label, which is the whole point of a dedicated IconButton primitive.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { icon, variant = 'default', className, type = 'button', ...rest },
    ref
  ): JSX.Element => {
    const classes = ['icon-btn', `icon-btn--${variant}`, className]
      .filter(Boolean)
      .join(' ');
    return (
      <button ref={ref} type={type} className={classes} {...rest}>
        <span className="icon-btn__icon" aria-hidden="true">
          {icon}
        </span>
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
