import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

/**
 * Card primitive — a raised surface with rounded corners and an elevation
 * shadow. All colors / radii / shadows come from tokens.
 *
 * `as="section"` is the default. Pass `as="article"` or other semantics
 * via the element you wrap it with — Card is purely visual.
 *
 * Cycle-72 ships sibling exports `<CardHeader>` / `<CardTitle>` /
 * `<CardSubtitle>` / `<CardActions>` for in-card composition. `<Card>`'s
 * `children` remains the body — consumers compose `<CardHeader>` as the
 * first child then their own content. See CLAUDE.md "Card compound
 * primitives".
 */
export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Visual emphasis. `flat` removes the shadow (used inside scrollers). */
  variant?: 'default' | 'flat';
};

export const Card = ({
  children,
  variant = 'default',
  className,
  ...rest
}: CardProps): JSX.Element => {
  const classes = ['card', `card--${variant}`, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
};

/**
 * CardHeader — a flex row hosting the title block (left) and any
 * action buttons (right). Place as the first child of `<Card>`. Pairs
 * with `<CardTitle>` / `<CardSubtitle>` / `<CardActions>`.
 */
export type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ children, className, ...rest }, ref) => {
    const classes = ['card__header', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={classes} {...rest}>
        {children}
      </div>
    );
  }
);
CardHeader.displayName = 'CardHeader';

/**
 * CardTitle — the canonical heading inside a `<Card>`. Renders as `<h2>`
 * by default. Pass `as="h3"` (or h4) when the Card is nested under a
 * higher-level heading (e.g. a properties sidebar within a screen
 * section). Pass `className` for compatibility shims (e.g.
 * `section-title` co-applied when an e2e selector depends on the legacy
 * class).
 */
export type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
};

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ children, className, as: As = 'h2', ...rest }, ref) => {
    const classes = ['card__title', className].filter(Boolean).join(' ');
    return (
      <As ref={ref} className={classes} {...rest}>
        {children}
      </As>
    );
  }
);
CardTitle.displayName = 'CardTitle';

/**
 * CardSubtitle — secondary text below the title. Renders as `<p>` with
 * muted styling.
 */
export type CardSubtitleProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
};

export const CardSubtitle = forwardRef<HTMLParagraphElement, CardSubtitleProps>(
  ({ children, className, ...rest }, ref) => {
    const classes = ['card__subtitle', className].filter(Boolean).join(' ');
    return (
      <p ref={ref} className={classes} {...rest}>
        {children}
      </p>
    );
  }
);
CardSubtitle.displayName = 'CardSubtitle';

/**
 * CardActions — flex row of action buttons, right-aligned by default via
 * `margin-left: auto`. Place inside `<CardHeader>` next to the title
 * block.
 */
export type CardActionsProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export const CardActions = forwardRef<HTMLDivElement, CardActionsProps>(
  ({ children, className, ...rest }, ref) => {
    const classes = ['card__actions', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={classes} {...rest}>
        {children}
      </div>
    );
  }
);
CardActions.displayName = 'CardActions';
