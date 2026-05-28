# House Electricals UX Refactor

User-directed total refactor of the navigation and screen structure.
Started 2026-05-28 inside an autonomous `/loop` session.

## User goals (verbatim)

1. Too much cross-cutting — divide concerns intuitively.
2. Tabs are not clear; can add more tabs.
3. Multiple ways of doing the same thing — collapse to one canonical path per action.
4. "I have no clear page where I can click on a component on the map and see which breaker slot it uses." — primary daily-driver pain.
5. Consistency + beauty across screens.
6. No feature loss. DB reset allowed.
7. Tested with Playwright.

## Diagnosis of current pain

The app is **panel-rooted** in its URLs and tab grouping, but the user thinks
**house-rooted** — "my house has floors, floors have rooms, rooms have components,
components are wired to breakers in panels".

Concrete symptoms:

- `/map` (MapLandingScreen, "list of floors") and `/panels/:id/map`
  (PanelMapScreen, "pins for one panel on one floor") share the Map tab —
  fundamentally different screens behind the same icon.
- `/floors/:id/edit` (FloorEditScreen, full-bleed canvas) is the most
  feature-rich "map" screen but lives in an escape-hatch route reachable
  only from MapLandingScreen.
- PanelMapScreen filters pins to **one panel's breakers** — confusing
  because a real floor has components from multiple panels.
- Component creation has two surfaces (ComponentsScreen modal + FloorEditScreen
  quick-create) and component editing has two surfaces (same).
- `/audit` is a flat route but discoverable only via a TestPanelScreen footer
  link.
- Selected component in FloorEditScreen shows type/room/position/gangs but
  **NOT the controlling breaker** — exactly the user's #1 complaint.

## New information architecture

### Four tabs (was three)

| Tab          | Route       | Purpose                                          |
|--------------|-------------|--------------------------------------------------|
| Map          | `/`         | Where things are — floors, pins, breaker context |
| Panels       | `/panels`   | How things connect — panels, breakers, wiring    |
| Test         | `/test`     | Verify it works — walk-through + audit           |
| Library      | `/library`  | Search the inventory — flat list + bulk          |

### Routes

```
/                               → MapHomeScreen          (Map tab)
/?floor=<id>                    → MapHomeScreen, that floor active
/panels                         → PanelListScreen        (Panels tab)
/panels/:id                     → PanelDetailScreen
/panels/:id/print               → PrintableDiagramScreen (escape-hatch)
/test                           → TestHomeScreen (picker if many panels)
/test/:panelId                  → walk-through (was TestPanelScreen)
/test/audit                     → AuditScreen
/library                        → ComponentsScreen renamed
```

### Removed routes

- `/map` (MapLandingScreen) — folded into `/`
- `/panels/:id/map` (PanelMapScreen) — folded into `/`
- `/floors/:id/edit` (FloorEditScreen escape-hatch) — folded into `/`
- `/audit` (standalone) — moved under `/test/audit`
- `/components` — renamed to `/library` (back-compat redirect)
- `/panels/:id/test` — moved under `/test/:panelId`

### One canvas, one map

The new `/` (MapHomeScreen) is the only place pins live. It:

- Shows ALL components on the active floor, regardless of which panel
  their breaker lives on.
- Has a floor switcher in the header.
- Has the full FloorEditScreen tool palette (Pointer / Wall / Room /
  Outlet / Light / Switch) and keyboard shortcuts.
- Has the selected-component drawer.
- **NEW**: the drawer shows the controlling breaker — panel name, slot
  number, label, amperage, protection — plus a **mini panel-viz** with
  the controlling slot pulse-highlighted. This is the centerpiece fix
  for the user's #1 daily-driver complaint.

### Eliminated duplicate paths

| Action                  | Canonical surface              |
|-------------------------|--------------------------------|
| Create panel            | Panels tab header CTA          |
| Create floor            | Map tab header CTA             |
| Create component        | Library tab header CTA         |
| Quick-place component   | Map tab tool palette (O/L/S)   |
| Edit component          | Click pin or row → drawer/modal — single ComponentForm |
| Wire component → breaker| Inside ComponentForm only      |
| Delete component        | Drawer / row (30s undo)        |
| Mark breaker verified   | Test tab walk-through only     |
| Bulk-mark protected     | Panels tab aggregate card      |
| View audit log          | Test → Audit sub-tab           |
| Print diagram           | Panel detail header icon       |
| Wire floor → panel      | Map tab floor settings         |

## Phased rollout

| Phase | Scope | Iteration |
|-------|-------|-----------|
| 1 | Plan doc + memory checkpoint | 1 (this) |
| 2 | Add 4 tabs, add breaker-context drawer to Map | 1 (this) |
| 3 | Make `/` the new map (was MapLandingScreen) — fold FloorEditScreen | 2 |
| 4 | Add `/test` picker + move audit under it | 2 |
| 5 | Rename `/components` → `/library`; back-compat redirect | 3 |
| 6 | Remove `/panels/:id/map`, `/floors/:id/edit` chrome | 3 |
| 7 | Remove duplicate component-create paths | 4 |
| 8 | Visual consistency pass + token compliance check | 4 |
| 9 | Update e2e specs + new screenshots | 5 |
| 10 | Final commit + push | 5 |

## Phase progress log

- **2026-05-28 (iter 6 — final)**: wrap-up. FloorEditScreen ScreenHeader
  subtitle now shows "N placed · M unplaced" (or "N components placed"
  when complete) so the user knows at a glance how many components on
  this floor still need positioning. CLAUDE.md gains a top-of-file
  "UX refactor 2026-05" pin block documenting (a) the new 4-tab IA,
  (b) the new routes + back-compat aliases, (c) the breaker-context
  drawer contract + the `highlightedBreakerId` prop, (d) the deferred
  PanelMapScreen consolidation, (e) the token rule re-pin. Future
  cycles touching nav or the floor drawer MUST respect this section.
  37 specs across two final sweeps green on desktop-1440x900.

  DEFERRED to a future cycle: PanelMapScreen → FloorEditScreen full
  consolidation (port Unplaced sidebar + multi-select + bulk-actions).
  /panels/:id/map STILL WORKS today; nothing inbound links to it.

- **2026-05-28 (iter 5)**: breaker-context drawer polish. Added an
  "Open panel →" CTA at the bottom of the drawer that deep-links to
  `/panels/<id>#breaker-<breakerId>` — the cycle-22 G23 hash consumer
  on PanelDetailScreen pulses the matching slot so the round-trip
  (pin → drawer → panel detail → pulse) feels coherent. Added a
  scroll-into-view useEffect that scrolls the active slot inside the
  mini-viz into the center whenever selectedComponentId changes —
  important for panels deep enough that the active slot would otherwise
  be hidden below the drawer fold. New CSS: `.component-breaker-context__cta`.
  No new token NAMES. Spec extended with CTA assertion. 16 specs pass.

- **2026-05-28 (iter 4)**: landing screen metadata + AuditScreen back
  arrow. TestHomeScreen rows now show "N breakers · Last verified <when>"
  via listAllBreakersGrouped + latestBreakerTestsByIds (one shared fetch
  pair). MapLandingScreen floor rows now show "N components placed ·
  plan/no plan" via listComponents (counts include unwired — the map
  cares about spatial placement, not breaker wiring). AuditScreen's
  ScreenHeader gets a back arrow to /test when entered via the canonical
  /test/audit route; legacy /audit stays title-only. No new tokens; no
  CSS adds. Smoke + nav-test-tab + audit-screen + map-breaker-context
  all green on desktop, no mobile overflow at 390x844 on TestHomeScreen.

- **2026-05-28 (iter 3)**: collapsed duplicate map entry points + renamed
  the Components screen to Library. ComponentsScreen header is now
  "Library — Every component in the house…" (matches the Library tab
  label); its URL push tracks whichever pathname the user entered through
  (`/library` vs back-compat `/components`). MapLandingScreen dropped the
  Panels section entirely (panel management lives on the Panels tab; deep
  "where are my components" goes through the floor canvas + breaker
  drawer). PanelDetailScreen header link renamed `Floor plan` → `Open on
  map` and routes to the linked floor's canvas (or `/map` if no linked
  floor). Library "View on floor plan" row link now deep-links into
  `/floors/<floorId>/edit#pin-<componentId>`; FloorEditScreen gained the
  matching hash consumer + `id="pin-<id>"` on each pin so the existing
  cycle-13 G13 `data-highlight` rule fires the 1.5s pulse. FloorEditScreen
  "Panels here" rows now go to `/panels/<id>` (was `/panels/<id>/map`).
  TestPanelScreen empty-state CTA goes to `/floors/<floorId>/edit`.
  Updated 4 specs that hardcoded "Components" h1 → "Library". 31 desktop
  e2e specs pass on the relevant subset; typecheck clean.

- **2026-05-28 (iter 2)**: 4-tab shell + Test tab routes. `APP_TABS` is
  now Map / Panels / Test / Library (was Panels / Components / Map). New
  routes: `/test` (TestHomeScreen — panel picker + audit log link),
  `/test/:panelId` (TestPanelScreen, dual-routed with legacy
  `/panels/:id/test`), `/test/audit` (AuditScreen). Old `/audit` +
  `/panels/:id/test` kept as back-compat aliases. `/library` added as the
  canonical inventory route; `/components` remains as a passthrough.
  Internal call-sites updated (PanelDetailScreen → /test/:id; TestPanel
  audit-link → /test/audit). bottom-tabs grid is now CSS-var-driven
  (`--bottom-tabs-count`) so future tab-count tweaks don't need media
  queries. TestHomeScreen lists panels with tappable rows + audit link;
  the auto-redirect-on-single-panel idea was REMOVED after e2e showed it
  conflicted with the walk-through back button. New e2e:
  `nav-test-tab.spec.ts` (6 tests). Smoke + mobile-overflow + audit-screen
  + map-breaker-context all still green; typecheck clean.

- **2026-05-28 (iter 1)**: plan written; the centerpiece fix landed —
  FloorEditScreen's selected-component drawer now shows the controlling
  breaker (panel name, slot, amperage, label, protection) plus a mini
  panel-viz with the active slot ringed via `.panel-viz__slot--active`.
  Unwired pins surface a "Not wired to a breaker yet." prompt.
  PanelVisualization gained `highlightedBreakerId` prop (static, distinct
  from the cycle-22 1.5s hash pulse). New CSS: `.panel-viz__slot--active`,
  `.panel-viz--mini`, `.component-breaker-context*`. New e2e:
  `map-breaker-context.spec.ts` (2 tests, desktop-only). Smoke 8/8 still
  green; typecheck clean.

