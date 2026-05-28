import type { ReactNode } from 'react';
import {
  CircuitBoard,
  LayoutGrid,
  Lightbulb,
  Map as MapIcon,
} from 'lucide-react';
import { BottomTabs, type Tab } from './BottomTabs.js';
import { AccountButton } from './AccountButton.js';
import { LogoutButton } from './LogoutButton.js';
import { ThemeToggle } from './ThemeToggle.js';
import { VersionPill } from './VersionPill.js';

/**
 * The top-level chrome for every routed screen. Mounts once at the App root
 * and wraps the Switch. Provides:
 *   - constrained mobile content area (max-width from --layout-max-w)
 *   - bottom-tab navigation (Panels / Components / Map)
 *
 * NOTE (cycle-52): the sonner Toaster was previously mounted here. It now
 * lives in `main.tsx` (inside ThemeProvider, OUTSIDE the route Switch) so
 * escape-hatch routes (FloorEdit, /print) can fire toasts too. AppShell no
 * longer owns the toast surface — see CLAUDE.md "Library choices (pinned)".
 *
 * Escape hatch: for routes that need to bypass the bottom tabs entirely
 * (e.g. a future full-bleed drawing editor), route them OUTSIDE the AppShell-
 * wrapped Switch in App.tsx — this component does not expose an opt-out prop.
 *
 * `fullBleed` removes the inner content padding so screens can paint to the
 * edges (the map screen uses this). Tabs still render.
 */
export type AppShellProps = {
  children: ReactNode;
  /** Default false. Set true for screens whose primary content (e.g. a map)
   *  needs to paint to the viewport edges; bottom tabs still render. */
  fullBleed?: boolean;
};

/** Canonical tab definitions. Exported so tests or alt-shells can reuse.
 *
 * Refactor 2026-05 — 4 tabs (was 3). Aligns with the new IA:
 *   - Map: where things are (floors + pins + breaker context)
 *   - Panels: how things connect (panel detail + breakers + wiring)
 *   - Test: verify it works (walk-through + audit log)
 *   - Library: search the inventory (flat list + bulk)
 *
 * The Library tab points at `/library` (NEW canonical) — `/components`
 * is kept as a back-compat alias this iteration; a follow-up cycle will
 * delete the alias once nothing links to it. */
export const APP_TABS: readonly Tab[] = [
  {
    label: 'Map',
    href: '/map',
    icon: <MapIcon size={22} strokeWidth={2} />,
    // Map tab covers the panel-agnostic landing AND any panel's map page
    // AND the floor edit canvas (which is being promoted to the canonical
    // map surface in a follow-up cycle).
    isActive: (loc) =>
      loc === '/map' ||
      /^\/panels\/[^/]+\/map$/.test(loc) ||
      /^\/floors\/[^/]+\/edit$/.test(loc),
  },
  {
    label: 'Panels',
    href: '/',
    icon: <LayoutGrid size={22} strokeWidth={2} />,
    // Panels tab covers root + panel detail. Walk-through has moved to the
    // Test tab; the legacy `/panels/:id/test` route still works but the
    // Test tab is the canonical entry point.
    isActive: (loc) =>
      loc === '/' ||
      (loc.startsWith('/panels/') &&
        !loc.endsWith('/map') &&
        !loc.endsWith('/test')),
  },
  {
    label: 'Test',
    href: '/test',
    icon: <CircuitBoard size={22} strokeWidth={2} />,
    // Test tab covers the picker, the per-panel walk-through (new
    // /test/:panelId path + the legacy /panels/:id/test), AND the audit log.
    isActive: (loc) =>
      loc === '/test' ||
      loc.startsWith('/test/') ||
      loc === '/audit' ||
      /^\/panels\/[^/]+\/test$/.test(loc),
  },
  {
    label: 'Library',
    href: '/library',
    icon: <Lightbulb size={22} strokeWidth={2} />,
    isActive: (loc) =>
      loc.startsWith('/library') || loc.startsWith('/components'),
  },
];

export const AppShell = ({
  children,
  fullBleed = false,
}: AppShellProps): JSX.Element => {
  return (
    <div className="app-shell">
      <div
        className={
          fullBleed
            ? 'app-shell__content app-shell__content--full-bleed'
            : 'app-shell__content'
        }
      >
        {children}
      </div>
      <ThemeToggle />
      <AccountButton />
      <LogoutButton />
      <VersionPill />
      <BottomTabs tabs={APP_TABS} />
    </div>
  );
};
