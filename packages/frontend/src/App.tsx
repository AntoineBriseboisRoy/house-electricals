import { Route, Switch, useLocation } from 'wouter';
import { AppShell } from './ui/AppShell.js';
import { BuildingProvider, useBuilding } from './contexts/BuildingContext.js';
import { PanelListScreen } from './screens/PanelListScreen.js';
import { PanelDetailScreen } from './screens/PanelDetailScreen.js';
import { ComponentsScreen } from './screens/ComponentsScreen.js';
import { TestHomeScreen } from './screens/TestHomeScreen.js';
import { TestPanelScreen } from './screens/TestPanelScreen.js';
import { PanelMapScreen } from './screens/PanelMapScreen.js';
import { MapLandingScreen } from './screens/MapLandingScreen.js';
import { FloorEditScreen } from './screens/FloorEditScreen.js';
import { PrintableDiagramScreen } from './screens/PrintableDiagramScreen.js';
import { AuditScreen } from './screens/AuditScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { SignupScreen } from './screens/SignupScreen.js';
import { useAuth } from './contexts/AuthContext.js';

/**
 * Top-level router (G11 + G16).
 *
 * Two layers of routing:
 *   - Routes that need the AppShell chrome (bottom tabs + max-width content
 *     area) live inside the `<AppShell>`-wrapped `<Switch>` below.
 *   - Routes that escape the shell entirely (canonical pattern documented in
 *     CLAUDE.md "Design system → AppShell escape hatch") are checked BEFORE
 *     entering AppShell. `/floors/:id/edit` is the first user of that pattern
 *     (G16); cycle-16's G15 desktop canvas continues here.
 *
 * The legacy PanelMapScreen `fullBleed` prop is grandfathered — do NOT add
 * new routes via fullBleed. Use the route-outside-Switch escape instead.
 */
export const App = (): JSX.Element => {
  const { state: authState } = useAuth();

  // feat/auth-gate — gate everything behind sign-up / login.
  //
  //   loading      → tiny splash while /api/v1/auth/setup-status (+ /me)
  //                  is in-flight.
  //   needs-setup  → SignupScreen (first-time setup, exactly once per
  //                  deployment — the backend's app_users table is empty).
  //   unauthed     → LoginScreen (full-bleed, no AppShell chrome).
  //   authed       → fall through to the normal router below.
  if (authState.phase === 'loading') {
    return <div className="app-auth-splash" aria-label="Loading" />;
  }
  if (authState.phase === 'needs-setup') {
    return <SignupScreen />;
  }
  if (authState.phase === 'unauthed') {
    return <LoginScreen />;
  }

  // Authed → mount the building layer (the /buildings endpoint is auth-gated)
  // and render the routed app inside it.
  return (
    <BuildingProvider>
      <AuthedApp />
    </BuildingProvider>
  );
};

/**
 * The authed, building-scoped app. Gates on the one-time building load (so the
 * api scope is set before any screen fetches), then renders the escape-hatch
 * or AppShell routes. Both route Switches are KEYED on the active building id:
 * switching buildings remounts the matched screen so it re-fetches its
 * now-rescoped data, while the AppShell chrome (tabs + building switcher)
 * stays mounted.
 */
const AuthedApp = (): JSX.Element => {
  const [location] = useLocation();
  const { phase, currentBuildingId } = useBuilding();
  const buildingKey = currentBuildingId ?? 'none';

  if (phase === 'loading') {
    return <div className="app-auth-splash" aria-label="Loading" />;
  }

  // Escape-hatch routes: matched first, render WITHOUT AppShell chrome.
  // Keep this list short — only routes that genuinely need the full
  // viewport (e.g. the floor management/edit canvas, the printable
  // breaker diagram) belong here.
  const isFloorEdit = /^\/floors\/[^/]+\/edit$/.test(location);
  const isPrint = /^\/panels\/[^/]+\/print$/.test(location);
  if (isFloorEdit || isPrint) {
    return (
      <Switch key={buildingKey}>
        <Route path="/floors/:id/edit" component={FloorEditScreen} />
        <Route path="/panels/:id/print" component={PrintableDiagramScreen} />
      </Switch>
    );
  }

  // Inside-shell routes: panel detail/map/test, components, map landing.
  const fullBleed = /^\/panels\/[^/]+\/map$/.test(location);
  return (
    <AppShell fullBleed={fullBleed}>
      <Switch key={buildingKey}>
        <Route path="/" component={PanelListScreen} />
        <Route path="/map" component={MapLandingScreen} />
        <Route path="/panels/:id/map" component={PanelMapScreen} />
        {/* Refactor 2026-05 — Test tab routes. /test is the picker; the
            per-panel walk-through and audit log live under it. The legacy
            /panels/:id/test + /audit stay as back-compat aliases for now;
            a follow-up cycle removes them once nothing links to them. */}
        <Route path="/test" component={TestHomeScreen} />
        <Route path="/test/audit" component={AuditScreen} />
        <Route path="/test/:panelId" component={TestPanelScreen} />
        <Route path="/panels/:id/test" component={TestPanelScreen} />
        <Route path="/audit" component={AuditScreen} />
        <Route path="/panels/:id" component={PanelDetailScreen} />
        {/* Library tab — canonical /library; /components is a back-compat
            alias this iteration. */}
        <Route path="/library" component={ComponentsScreen} />
        <Route path="/components" component={ComponentsScreen} />
        <Route>
          <div className="app__header">
            <h1>Not found</h1>
            <p>That route doesn't exist.</p>
            <a href="/">Go home</a>
          </div>
        </Route>
      </Switch>
    </AppShell>
  );
};
