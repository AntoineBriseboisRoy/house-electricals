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
 */
export const BottomTabs = ({ tabs }: { tabs: readonly Tab[] }): JSX.Element => {
  const [location] = useLocation();
  // Refactor 2026-05 — surface tab count to CSS so the grid auto-adapts
  // when this list grows (3 → 4 in iter 2). Cast string for inline style.
  const navStyle = { ['--bottom-tabs-count' as string]: String(tabs.length) };
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
      </ul>
    </nav>
  );
};
