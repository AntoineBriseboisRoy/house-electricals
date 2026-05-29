import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';

export type Tab = {
  /** Label shown under the icon. */
  label: string;
  /** Route this tab navigates to. */
  href: string;
  /** lucide-react icon (or any ReactNode). Should render ~22px. */
  icon: ReactNode;
  /** Predicate against current location for active-state. Lets one tab cover
   *  multiple routes (e.g. Map tab is active on /map AND /panels/:id/map). */
  isActive: (location: string) => boolean;
};

/**
 * Mobile-first bottom navigation bar. Receives the full tab list as a prop
 * (no hardcoding) so future cycles can extend it cleanly. Each tab is a >=44px
 * tap target.
 *
 * Active-state is derived from wouter's `useLocation` via each tab's
 * `isActive` predicate — never from `href` equality alone, since one tab
 * may cover several routes (Map tab covers /map and /panels/:id/map).
 *
 * fix/mobile-floating-cluster — `trailing` renders a non-navigation item as
 * the LAST cell of the tab grid (e.g. the Account menu trigger that opens a
 * bottom sheet). It's a sibling `<li>` inside the same `<ul>` so it lines up
 * in the grid; the `--bottom-tabs-count` var includes it so the columns
 * stay evenly sized. The account/theme/logout controls used to be a fixed
 * floating chip on every screen — they now live behind this tab item so
 * nothing floats over page content (HousesTracker pattern).
 */
export const BottomTabs = ({
  tabs,
  trailing,
}: {
  tabs: readonly Tab[];
  /** Optional non-navigation item rendered as the last grid cell. */
  trailing?: ReactNode;
}): JSX.Element => {
  const [location] = useLocation();
  // Refactor 2026-05 — surface tab count to CSS so the grid auto-adapts
  // when this list grows (3 → 4 in iter 2). The `trailing` item, when
  // present, counts as one more column. Cast string for inline style.
  const count = tabs.length + (trailing != null ? 1 : 0);
  const navStyle = { ['--bottom-tabs-count' as string]: String(count) };
  return (
    <nav className="bottom-tabs" aria-label="Primary" style={navStyle}>
      <ul className="bottom-tabs__list">
        {tabs.map((tab) => {
          const active = tab.isActive(location);
          return (
            <li key={tab.href} className="bottom-tabs__item">
              <Link
                href={tab.href}
                className={
                  active
                    ? 'bottom-tabs__link bottom-tabs__link--active'
                    : 'bottom-tabs__link'
                }
                aria-current={active ? 'page' : undefined}
              >
                <span className="bottom-tabs__icon" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="bottom-tabs__label">{tab.label}</span>
              </Link>
            </li>
          );
        })}
        {trailing != null && (
          <li className="bottom-tabs__item">{trailing}</li>
        )}
      </ul>
    </nav>
  );
};
