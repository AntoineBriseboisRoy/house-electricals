import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';

/**
 * Contextual screen header. Renders a sticky bar at the top of an AppShell-
 * wrapped screen. Title is required; an optional back action and an arbitrary
 * right action (via `children`) compose around it.
 *
 * Touch targets are >= 44px.
 *
 * Usage:
 *   <ScreenHeader title="Panel" back="/" >
 *     <Link href={`/panels/${id}/map`}>Map</Link>
 *   </ScreenHeader>
 */
export type ScreenHeaderProps = {
  title: string;
  /** Path to navigate to via wouter when the user taps the back arrow.
   *  Use `back` for typed navigation, or omit to hide the back button. */
  back?: string;
  /** Optional sublabel under the title (e.g. panel name on a sub-screen). */
  subtitle?: string;
  /** Right-side action area — typically a single link/IconButton. */
  children?: ReactNode;
};

export const ScreenHeader = ({
  title,
  back,
  subtitle,
  children,
}: ScreenHeaderProps): JSX.Element => {
  const [, navigate] = useLocation();
  return (
    <header className="screen-header">
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
    </header>
  );
};
