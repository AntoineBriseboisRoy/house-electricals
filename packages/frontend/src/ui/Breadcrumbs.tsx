import { Fragment } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumbs primitive (G42(b)).
 *
 * A slim breadcrumb navigation strip that gives deep-linked visits nav
 * context — e.g. "Panels › Main Panel" or "Map › Main Floor". Rendered
 * above the screen title (see ScreenHeader's `breadcrumbs` prop) so it
 * does NOT duplicate the title.
 *
 * Contract:
 *   - Each crumb is `{ label, href? }`. A crumb WITH `href` is a wouter
 *     `<Link>`; the LAST crumb (the current page) MUST omit `href` — it
 *     renders as plain text with `aria-current="page"`.
 *   - lucide `ChevronRight` separators between crumbs (aria-hidden).
 *   - Token-only styling (no new token NAMES — cycle-11/17/20 rule). All
 *     visuals come from the `.breadcrumbs*` rules in styles.css.
 *   - Mobile-friendly: long labels ellipsis-truncate; links keep a ≥44px
 *     touch hit-area via padding (see styles.css). On very narrow screens
 *     the leaf crumb wins the available width (the parent crumbs shrink).
 *
 * DOM hooks (READ-ONLY e2e contract):
 *   - `data-testid="breadcrumbs"` on the <nav>
 *   - `data-testid="breadcrumb-crumb"` on each crumb (link OR leaf span)
 */
export type Crumb = {
  /** Visible label. Long labels ellipsis-truncate via CSS. */
  label: string;
  /** wouter path. Omit on the LAST (current-page) crumb. */
  href?: string;
};

export type BreadcrumbsProps = {
  /** Ordered crumbs, root → current. The last one is the current page
   *  and should omit `href`. */
  items: Crumb[];
  /** Accessible label for the nav landmark. Defaults to "Breadcrumb". */
  'aria-label'?: string;
};

export const Breadcrumbs = ({
  items,
  'aria-label': ariaLabel = 'Breadcrumb',
}: BreadcrumbsProps): JSX.Element | null => {
  if (items.length === 0) return null;
  return (
    <nav className="breadcrumbs" aria-label={ariaLabel} data-testid="breadcrumbs">
      <ol className="breadcrumbs__list">
        {items.map((crumb, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              <li className="breadcrumbs__item">
                {isLast || crumb.href === undefined ? (
                  <span
                    className="breadcrumbs__crumb breadcrumbs__crumb--current"
                    aria-current="page"
                    data-testid="breadcrumb-crumb"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="breadcrumbs__crumb breadcrumbs__crumb--link"
                    data-testid="breadcrumb-crumb"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
              {!isLast && (
                <li
                  className="breadcrumbs__sep"
                  aria-hidden="true"
                  role="presentation"
                >
                  <ChevronRight size={14} strokeWidth={2.25} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
};
