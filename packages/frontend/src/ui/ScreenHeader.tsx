import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Breadcrumbs, type Crumb } from './Breadcrumbs.js';

/**
 * Contextual screen header. Renders a sticky bar at the top of an AppShell-
 * wrapped screen. Title is required; an optional back action and an arbitrary
 * right action (via `children`) compose around it.
 *
 * G42(b) — an optional `breadcrumbs` strip renders ABOVE the title row so
 * deep-linked visits get nav context ("Panels › Main Panel") without
 * duplicating the title. The last crumb is the current page (non-link).
 *
 * Touch targets are >= 44px.
 *
 * Usage:
 *   <ScreenHeader
 *     title="Main Panel"
 *     back="/"
 *     breadcrumbs={[{ label: 'My House' }, { label: 'Panels', href: '/' }, { label: 'Main Panel' }]}
 *   >
 *     <Link href={`/floors/${id}/edit`}>Map</Link>
 *   </ScreenHeader>
 */
export type ScreenHeaderProps = {
  title: string;
  /** Path to navigate to via wouter when the user taps the back arrow.
   *  Use `back` for typed navigation, or omit to hide the back button. */
  back?: string;
  /** Optional sublabel under the title (e.g. panel name on a sub-screen). */
  subtitle?: string;
  /** Optional breadcrumb trail rendered above the title row. The last
   *  crumb is the current page and should omit `href`. */
  breadcrumbs?: Crumb[];
  /** Right-side action area — typically a single link/IconButton. */
  children?: ReactNode;
};

export const ScreenHeader = ({
  title,
  back,
  subtitle,
  breadcrumbs,
  children,
}: ScreenHeaderProps): JSX.Element => {
  const [, navigate] = useLocation();
  return (
    <header className="screen-header">
      {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} />
      )}
      <div className="screen-header__bar">
        {back !== undefined ? (
          <button
            type="button"
            className="screen-header__back"
            aria-label="Back"
            onClick={() => navigate(back)}
          >
            <ArrowLeft size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
        ) : (
          <span className="screen-header__back screen-header__back--spacer" aria-hidden="true" />
        )}
        <div className="screen-header__titles">
          <h1 className="screen-header__title">{title}</h1>
          {subtitle !== undefined && (
            <p className="screen-header__subtitle">{subtitle}</p>
          )}
        </div>
        <div className="screen-header__actions">{children}</div>
      </div>
    </header>
  );
};
