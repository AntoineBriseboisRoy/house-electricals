# Codebase notes for future agents

This is the project-root `CLAUDE.md`. It records *project-wide conventions* that future cycles must respect. Per-package context lives in `packages/*/CLAUDE.md` (if any). Story-specific details belong in commit messages / `scripts/ralph/progress.txt`, not here.

## Persistence is PostgreSQL (migrate/postgres) — READ FIRST

House Electricals moved off `node:sqlite` to **PostgreSQL** (branch
`migrate/postgres`) for reliability as the deployment scales. Many of the
historical per-cycle ADRs below were written in the SQLite era and describe
SQLite-specific mechanics (`openDatabase`, `DatabaseSync`, `sqlite_master`,
`PRAGMA table_info`, "ALTER can't add a CHECK so rebuild the table",
`node:sqlite`, `panels.db`, WAL files, `--experimental-sqlite`). **Those
mechanics are SUPERSEDED — read them as history, not current instructions.**
The data MODEL (tables, columns, FKs, cascade semantics, frozen enums) is
unchanged; only the engine + access layer changed. The current contract:

1. **`packages/backend/src/db.ts` is the ONLY file that talks to `pg`.** It
   exports `createPool(connectionString, opts?)`, the `Db` class, and the
   `Querier` interface. `Db` methods: `query<R>(sql, params?)` → rows;
   `queryOne<R>` → first row or null; `execute(sql, params?)` → rowCount;
   `exec(sql)` → runs trusted multi-statement DDL via the **simple** protocol
   (the ONLY safe way — passing a `values` array switches pg to the extended
   protocol, which rejects multi-statement/dollar-quoted strings); `transaction(fn)`
   → runs `fn` on a dedicated pooled client with BEGIN/COMMIT/ROLLBACK; `close()`.

2. **Placeholders are `$1, $2, …` (pg positional), never `?`.**

3. **Epoch-ms timestamps are `BIGINT`, not `INTEGER`.** Postgres `INTEGER` is
   32-bit and `Date.now()` overflows it. `db.ts` registers a `pg.types`
   parser mapping BIGINT (OID 20) → JS number on load.

4. **Schema init is `initSchema(db)` in `repository.ts`** (was `openDatabase`).
   Idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` DDL
   run via `Db.exec`. Repositories are `PgPanelRepository`,
   `PgBreakerRepository`, `PgComponentRepository`, `PgFloorRepository`,
   `PgWallRepository`, `PgRoomRepository`, `PgBreakerTestRepository`,
   `PgServiceEntryRepository`, `PgAppUserRepository` (was `Sqlite*`).

5. **Error codes are SQLSTATE strings on `err.code`:** UNIQUE violation =
   `23505`, CHECK violation = `23514`, FK violation = `23503`. (Was sniffing
   SQLite's `err.message.includes('UNIQUE constraint failed')`.)

6. **Tests use schema-per-suite isolation against a REAL Postgres.**
   `createTestDb()` in `test-helpers.ts` makes a pool scoped to a unique
   `test_<ulid>` schema via `-c search_path=…`; `cleanup()` drops the schema
   CASCADE + closes the pool. `DATABASE_URL` defaults to
   `postgresql://postgres:postgres@localhost:5433/house_electricals` (the
   `docker-compose.dev.yml` `he-postgres` container, host port 5433).
   Run `docker compose -f docker-compose.dev.yml up -d` before `pnpm test`.

7. **Connection config is `DATABASE_URL`** (no more `DB_PATH`). The backend
   refuses to boot without it. `DATA_DIR` (default `/data`) now anchors ONLY
   the `.auth-secret` file; floor-plan images live under `FLOOR_PLAN_DIR`.
   Optional `DB_SCHEMA` + `DB_RESET` env vars scope/reset a named schema
   (used by the e2e harness for a clean `e2e` schema; `DB_RESET` is test-only
   and only ever drops the NAMED schema, never `public`).

## Multi-building layer (2026-05) — READ before touching panels/floors/components

A top-level **Building** entity now owns the whole tree. Every `panel`,
`floor`, and `component` has a `building_id` (NOT NULL, `ON DELETE CASCADE`);
breakers/walls/rooms/switch_controls/tests cascade through their parents. Pin
these decisions — future cycles touching the data model, list/create paths, or
app shell MUST respect them.

1. **`buildings` table** — `id` (ULID), `name` UNIQUE, `created_at`. Created
   in `initSchema` AFTER panels/floors/components, then `building_id` is
   attached to those three via an idempotent `DO $$` migration (ADD COLUMN
   nullable → backfill to the oldest building → `SET NOT NULL` + FK). A default
   **"My House"** (`id='building_default'`) is seeded **only when the table is
   empty** (`WHERE NOT EXISTS (SELECT 1 FROM buildings)`) — never resurrects a
   user-deleted default. So there is ALWAYS ≥1 building.

2. **Per-building name uniqueness.** The global `idx_unique_panels_name` /
   `idx_unique_floors_name` were swapped (guarded, once) for
   `idx_unique_{panels,floors}_building_name` on `(building_id, name)` — two
   buildings can both have a "Main Panel"/"Main Floor". Rooms stay per-floor.

3. **`PgBuildingRepository.delete` is an app-level cascade** inside one
   transaction (service_entries → components → breakers → panels → floors →
   building), because the panels→breakers edge has no DB CASCADE (cascades are
   app-level by design). A plain FK cascade from the building would fail there.

4. **Repos default the building.** `PgPanelRepository.create` /
   `PgFloorRepository.create` / `PgComponentRepository.create` accept an
   optional `buildingId`; when absent they resolve `resolveBuildingId(db)` =
   the oldest building. `list(filter?)` takes an optional `{ buildingId }` and
   filters when present. This keeps the backend test suite + the e2e REST seed
   green WITHOUT passing buildingId everywhere (they land in "My House").

5. **Routes**: flat REST `routes/buildings.ts` (`GET/POST /buildings`,
   `GET/PATCH/DELETE /buildings/:id`), mounted PROTECTED in `server.ts`;
   `AppDeps.buildingRepository` + `index.ts`/`test-helpers.ts` instantiate it.
   DELETE **refuses the last building (409)** so the app never reaches a
   zero-building state. `GET /panels` + `/floors` read `?buildingId`;
   `GET /components` adds `buildingId` to its query schema; the three POSTs
   accept `buildingId` in the body (the input schemas carry it, optional).

6. **Frontend scopes at the API layer, NOT per call site.** `api.ts` holds a
   module-level `activeBuildingId` + `setActiveBuildingId(id)`. `listPanels` /
   `listFloors` auto-append `?buildingId`; `listComponents` adds it to params;
   `createPanel`/`createFloor`/`createComponent` inject it into the body via
   `withActiveBuilding(...)`. So the ~12 existing screen call sites were left
   UNCHANGED. `listBuildings` is NOT scoped (it lists all buildings).

7. **`BuildingContext`** (`contexts/BuildingContext.tsx`) owns the building
   list + active selection (localStorage key `he.current-building`), mirrors
   the selection into `setActiveBuildingId` **synchronously** before marking
   ready, and is mounted INSIDE the authed tree in `App.tsx` (the `/buildings`
   endpoint is auth-gated). `<AuthedApp>` gates on its `phase==='loading'`,
   and **keys both route `<Switch>`es on `currentBuildingId`** — switching
   buildings remounts the matched screen so it re-fetches its now-rescoped
   data, while the AppShell chrome stays mounted.

8. **`<BuildingSwitcher>`** (`ui/`) sits in a slim `.app-shell__topbar` above
   every shell screen: a pill (`data-testid="building-switcher"`) showing the
   current building that opens **`<BuildingsModal>`** — a base `Modal`
   (`presentation="sheet"`) with **Add** in the header-action slot (top-right,
   `Modal.headerAction` prop — 2026-05) next to the X. Each building is a
   tap-to-switch row with a **pen (rename)** + **trash (delete)** IconButton on
   the right (per-row destructive convention: `variant="danger"` + `Trash2`);
   the trash is hidden when only one building exists (can't delete the last).
   No footer — the header X is the sole dismiss. Create/rename/delete layer
   useModal prompt/confirm dialogs ON TOP of the BuildingsModal (the cycle-61f
   base-Modal + useModal stacking pattern). The switcher pill uses
   `--radius-md` (rounded-square app theme, NOT a pill). testids:
   `building-switcher`, `buildings-modal`, `buildings-modal-add`,
   `buildings-list`, `buildings-list-switch` (+ `data-building-id`),
   `buildings-list-rename`, `buildings-list-delete`.

9. **Tests**: `packages/backend/src/buildings.test.ts` (seed default, CRUD,
   409 duplicate, per-building uniqueness, `?buildingId` scoping, last-building
   guard, cascade-delete incl. breakers, + the moves below). Added to the
   explicit file list in `backend/package.json`'s `test` script (no glob).

10. **Move between buildings.** `PanelRepository.moveToBuilding(panelId,
    buildingId)` + `FloorRepository.moveToBuilding(floorId, buildingId)` are
    transactional: they move the container AND its dependent components'
    `building_id`, then clean up cross-building refs so nothing dangles —
    moving a panel detaches its feeder + any subpanels it feeds that would
    cross buildings, and unplaces moved components from floors in another
    building; moving a floor detaches a cross-building default-panel link and
    unwires moved components from breakers in another building (walls/rooms
    follow via `floor_id`). Routes: `POST /api/v1/{panels,floors}/:id/move`
    `{ buildingId }` → 200 / 404 (not found) / 409 (name collision in target,
    per-building UNIQUE) / 400 (FK 23503 = target building missing). Frontend
    `<MoveToBuildingButton kind id name>` (on PanelDetailScreen +
    FloorEditScreen) picks a target via useModal, then **switches the active
    building to the target** so the user follows the moved item (the flat
    `getPanel`/`getFloor` still resolve it under the new building). Hidden when
    only one building exists. testid `move-{panel,floor}-to-building`.

## Auth gate (feat/auth-gate + sign-up flow)

Single-user JWT-cookie auth. Every `/api/v1/*` route except the public
carve-outs (`/auth/signup`, `/auth/login`, `/auth/logout`,
`/auth/setup-status`, `/health`) requires a valid `he_auth` cookie
signed with `AUTH_SECRET`. Pin these decisions — future cycles touching
auth, routes, or test setup MUST respect them.

1. **Credentials live in Postgres, NOT env vars.** The `app_users` table
   holds exactly 0 or 1 row: `id`, `username`, `password_hash`,
   `created_at`. The hash is scrypt-encoded (`scrypt$N=…,r=…,p=…$salt$hash`
   PHC-ish format — see `backend/src/password.ts`). There are NO
   `AUTH_USERNAME` / `AUTH_PASSWORD` env vars; an earlier feat/auth-gate
   cycle read them, that path is gone. Do not re-introduce env-var
   credentials without an ADR.

2. **First-boot UX = sign-up screen.** `GET /api/v1/auth/setup-status`
   returns `{ needsSetup }` based on `hasAnyUser()`. The frontend
   probes this on mount; `needsSetup=true` renders `<SignupScreen />`,
   `false` falls through to the existing `loading → authed | unauthed`
   path. `POST /auth/signup` is rejected with 409 once any user exists
   — the sign-up screen is reachable EXACTLY ONCE per deployment.

3. **`AUTH_SECRET` is auto-generated** at first backend boot
   (`crypto.randomBytes(48) → hex`) and persisted to
   `${DATA_DIR}/.auth-secret` with mode 600. Subsequent boots read the
   file. Deleting it invalidates every session cookie — the canonical
   "log everyone out" lever (the user row stays untouched; they sign
   back in with the same password).

4. **Cookie name = `he_auth`.** HttpOnly, SameSite=Lax, Secure=false
   (the app runs over plain HTTP behind the operator's reverse proxy),
   30-day Max-Age. Value is a Hono-signed JWT (HS256) with
   `{ sub: username, iat, exp }`. Do NOT rename the cookie — every spec
   + the frontend storageState file + the auth route handler hard-code
   `he_auth`.

5. **Middleware mount order is load-bearing**:
   public auth routes (`/auth/signup`, `/auth/login`, `/auth/logout`,
   `/auth/setup-status`) → `/api/v1/health` → JWT middleware guarding
   `/api/v1/*` → `onError` translating JWT-401 to the canonical
   `{ error: { message: 'Unauthenticated.' } }` envelope → protected
   auth routes (`/auth/me`, `/auth/password`) → all other protected
   routes. Adding a new public route requires mounting it BEFORE the
   JWT middleware AND updating this pin.

6. **`AppDeps.auth: AuthConfig | null`** + `AppDeps.appUserRepository:
   AppUserRepository | null` in `server.ts:buildApp(...)`. When either
   is `null`, the JWT middleware is NOT mounted — this is the
   test-bypass mode. All backend `*.test.ts` files pass both as `null`;
   `auth.test.ts` passes real instances. Do NOT thread real auth into
   the bulk backend test suite — those tests would have to login +
   cookie-thread every request for zero coverage gain.

7. **Password hash format is PHC-ish, not raw bytes.** The
   `scrypt$N=…,r=…,p=…$salt-b64$hash-b64` string embeds the kdf
   parameters next to the hash, so future cycles can rotate N/r/p
   without breaking existing rows. `verifyPassword(supplied, encoded)`
   re-derives with the stored params and `timingSafeEqual`s the result.
   `hashPassword(plain)` always writes the current default params
   (cycle-`feat/auth-gate-signup`: N=32768, r=8, p=1). Do NOT change
   the encoding without a migration that re-hashes on next login.

8. **Login is constant-time across user-exists and user-missing**.
   `/auth/login` always runs a scrypt verify — when the username
   doesn't exist, it uses a pinned placeholder encoded hash. Without
   this, a username-enumeration timing oracle leaks valid usernames.

9. **Change-password contract**. `PATCH /api/v1/auth/password`
   requires a valid cookie + correct `currentPassword` + 8+ char
   `newPassword`. The cookie stays valid after the change (JWT
   signature depends on `AUTH_SECRET`, not the password hash) — the
   user does NOT need to re-login. A future cycle MAY add a
   "log other sessions out" gesture by rotating `AUTH_SECRET`; out of
   scope today.

10. **Frontend auth state is a context**, NOT URL-routed. `AuthContext`
    wraps `App` in `main.tsx`. State machine: `'loading'` (probe
    `/auth/setup-status` then `/auth/me`) → `'needs-setup'` (signup
    screen) | `'authed'` | `'unauthed'`. `App.tsx` branches on
    `state.phase`. A 401 from ANY `/api/v1/*` call flips to
    `'unauthed'` via `setUnauthorizedHandler` (never `'needs-setup'` —
    the user row still exists; only the cookie is stale).

11. **Floating top-right cluster = 3 buttons, right-to-left:**
    `<ThemeToggle />`, `<AccountButton />`, `<LogoutButton />`. All
    are `position: fixed`. AccountButton opens the
    `<ChangePasswordModal />`. The cluster reserves
    `3 * --touch-target + --space-3 + 2 * --space-2` on
    `.screen-header { padding-right }` so header CTAs don't slip
    behind it (cycle-34 G28 extended). DOM testids:
    `account-button`, `change-password-modal`, `logout-button`.

12. **e2e auth contract.** `globalSetup.ts` spawns the backend with
    NO `AUTH_USERNAME` / `AUTH_PASSWORD` env vars; after backend is
    ready it calls `signupForSeed()` (in `seed.ts`) to mint the
    `e2e-user` / `e2e-password` account via `POST /auth/signup`, then
    writes a Playwright `storageState` file at `e2e/.auth.json`
    (gitignored) with the returned cookie. `playwright.config.ts`
    sets that file as global `use.storageState` so every spec starts
    pre-authed. The cookie is scoped to domain `127.0.0.1` so it
    survives both backend (port 3100) and Vite proxy (port 5180)
    origins. The readiness probe uses unauthed `/api/v1/health`.

13. **`e2e/authed-fetch.ts` is the canonical helper** for specs that
    talk to the backend directly (NOT via `page` / NOT via
    Playwright's `request` fixture). It reads the cookie from
    `e2e/.auth.json` once per process and attaches it to every fetch.
    Playwright's `request` fixture already inherits `storageState`
    automatically — those callsites do NOT need `authedFetch`. Specs
    MUST use `authedFetch` when calling the backend via raw `fetch()`.

14. **`/api/v1/health` is the unauthed liveness probe** — used by
    `waitForBackend` in globalSetup, the Docker healthcheck, and any
    monitoring you wire up. Do NOT widen its response shape or add
    auth-gated info to it. Keep it `{ data: { ok: true } }` forever.

15. **The `data/.auth-secret` file + `app_users` table are
    user-survivable data.** Back BOTH up: `.auth-secret` lives under
    `DATA_PATH` (filesystem bind-mount); `app_users` is a table in the
    Postgres volume (`he-pgdata`). Deleting `.auth-secret` = log everyone
    out (user stays). Deleting the `app_users` row = full reset
    (sign-up screen appears again). Documented in README.md (Login
    section) + DEPLOYMENT.md (Data Persistence section).

## UX refactor 2026-05 (5-commit autonomous loop)

The "Components/Panels/Map" 3-tab IA was reorganized to a 4-tab IA after the
user described navigation as "super confusing" and pointed at the missing
click-pin-see-breaker-slot affordance as the daily-driver pain. Pin these
decisions — future cycles touching navigation, tab structure, or the floor
canvas drawer MUST respect them. Full plan + per-iter log in
`docs/REFACTOR.md`.

1. **4-tab shell**: `APP_TABS` is `Map · Panels · Test · Library` (was
   `Panels · Components · Map`). `--bottom-tabs-count` CSS var on the
   bottom-tabs nav drives the grid columns; tab-count changes don't
   require a media-query fork. Each tab maps to ONE concern: Map = where
   things are; Panels = how they connect; Test = verify it works;
   Library = search the inventory.

2. **Test tab sub-routes**: `/test` → TestHomeScreen (panel picker +
   audit-log link); `/test/:panelId` → TestPanelScreen; `/test/audit` →
   AuditScreen with a back arrow to /test. Legacy `/panels/:id/test` and
   `/audit` are still wired as back-compat aliases. The walk-through is
   dual-routed via two parallel `useRoute` calls; the back-button target
   adapts (`/test` vs `/panels/<id>`) to whichever entry path the user
   took. **Do NOT delete the legacy aliases** without first auditing
   bookmarks and external links — a future cycle may remove them after
   verifying no inbound references remain.

3. **Library route**: `/library` is canonical; `/components` is the
   back-compat alias. ComponentsScreen renders the same regardless of
   pathname; its URL push (`?search=`) tracks whichever pathname the user
   entered through. The screen header reads "Library" — the tab-label
   matches.

4. **Breaker-context drawer** is the canonical answer to the user's #1
   complaint ("I have no clear page where I can click on a component on
   the map and see which breaker slot it uses"). When a pin is selected
   on `/floors/:id/edit`, the properties drawer shows panel name + slot
   + amperage + label + protection + a mini `<PanelVisualization>` with
   the controlling slot ringed via `panel-viz__slot--active` + a
   footer "Open panel →" CTA that deep-links to
   `/panels/<id>#breaker-<id>` (cycle-22 G23 hash pulses the slot on
   the panel detail). A useEffect scrolls the active slot into the
   center of the 280px mini-viz when selection changes. Unwired pins
   surface a "Not wired to a breaker yet." prompt; the existing cycle-86
   "Edit details" Modal is the canonical wire-from-canvas flow.
   `PanelVisualization.highlightedBreakerId` is the prop powering the
   static ring — independent of the cycle-22 1.5s `#breaker-<id>` hash
   pulse (they can coexist on the same panel-viz, e.g. when the user is
   ALSO arriving via a deep link).

5. **Internal link consolidation**: components "View on map" rows now go
   to `/floors/<floorId>/edit#pin-<componentId>` (was
   `/panels/<id>/map?floor=<id>#pin-<id>`). FloorEditScreen has the
   matching `#pin-<id>` hash consumer with the same data-highlight pulse
   pattern as PanelMapScreen. PanelDetailScreen header link reads
   "Open on map" and routes to the linked floor's `/floors/<id>/edit`
   (via `floors[].panelId`) with a `/map` fallback. FloorEditScreen
   "Panels here" rows go to `/panels/<id>` (no longer to
   `/panels/<id>/map`). MapLandingScreen dropped the Panels section
   entirely — panel management lives on the Panels tab; deep "where
   are this panel's components" now goes through the floor canvas
   drawer.

6. **Landing-screen metadata**: TestHomeScreen rows show "N breakers ·
   Last verified <when>" via `listAllBreakersGrouped` +
   `latestBreakerTestsByIds`. MapLandingScreen floor rows show
   "N components placed · plan/no plan" via `listComponents`.
   FloorEditScreen ScreenHeader subtitle shows
   "N placed · M unplaced" so the user knows at a glance how many
   components on this floor still need positioning.

7. **DEFERRED — PanelMapScreen → FloorEditScreen consolidation**:
   PanelMapScreen still exists with its Unplaced sidebar + multi-select
   + bulk-actions (cycle-50/51). Folding these into FloorEditScreen
   eliminates the last "two map screens" duplication but requires
   porting the Unplaced UX + the cycle-50 SelectionBar mount pattern
   (`body:has(.selection-bar) .bottom-tabs { display: none }`) without
   regressing either. Tracked as a follow-up. The route
   `/panels/:id/map` STILL works today and the e2e specs that drive it
   all pass.

8. **Token rule re-pinned**: no new token NAMES (cycle-11/17/20/22
   rule). The refactor introduced NO new tokens; new CSS classes
   (`.panel-viz__slot--active`, `.panel-viz--mini`,
   `.component-breaker-context*`, `.test-home__*`, `.bottom-tabs`
   `--bottom-tabs-count` var) read existing values only.

E2E coverage added: `map-breaker-context.spec.ts` (drawer + CTA),
`nav-test-tab.spec.ts` (4-tab shell + sub-routes + back-compat).
Specs that hard-coded `heading: 'Components'` were retargeted to
`'Library'` (smoke, nav-test-tab, component-wiring, floor-map-polish).

## Switch + controlled share one breaker (refactor follow-up)

Electrical reality: a switch and the load it controls are on the same
circuit, so they're on the same breaker. The backend enforces this
invariant on TWO write paths — every other surface (Library modal,
FloorEdit modal, drag-to-link, BreakerPicker, etc.) gets the propagation
for free.

1. **PATCH /api/v1/components/:id** (`SqliteComponentRepository.update`):
   when the patched component has `type === 'switch'` AND the patch
   includes `breakerId` AND the value actually changed, the repository
   wraps the UPDATE in a transaction and propagates the new breakerId
   to every component the switch controls (joined via
   `switch_controls.switch_id`). `null → null` is also propagated so
   the "switch.breakerId === every controlled.breakerId" invariant
   holds in BOTH wired and unwired states. Guarded by a `tableExists`
   check on `switch_controls` so the repo stays usable before the
   cycle-19 G19 migration runs.

2. **POST /api/v1/components/:id/controls** (`routes/switch-controls.ts`):
   after inserting the new switch_control row, the route patches the
   newly-controlled component's `breakerId` to match the switch's
   current value (even if null — pre-existing breakerIds get reset so
   the invariant holds from moment one). Skipped when the controlled
   is already on the correct breaker (idempotent no-op).

3. **Direction is one-way (switch → controlled)**. Patching a light or
   outlet's `breakerId` does NOT reverse-propagate to its controlling
   switch. The switch is the source of truth for the circuit; manual
   light-side patches are accepted but stay isolated. A follow-up cycle
   could escalate this to a bidirectional rule, but until then expect
   the switch's value to win on the next switch-PATCH.

4. **3-way / co-controlled lights**: when a light is controlled by
   TWO switches and they're on different breakers (electrically
   impossible IRL), the LAST switch-PATCH wins for the light. We do
   NOT cascade through siblings to keep both switches in sync — that
   was deemed a rabbit hole. The expected user workflow is to keep
   3-way switches manually on the same breaker; the data model
   accommodates the corner case without enforcing it.

5. **Frontend refresh**: the `addSwitchControl` callers on
   FloorEditScreen (drag-to-link + Modal picker via `handleAddControl`)
   call `refresh()` after a successful link so the drawer's
   breaker-context block reflects the just-propagated `breakerId`.
   Other surfaces (ComponentForm save in Library / FloorEdit Edit
   modal) already refresh their parent screen on save and pick up the
   propagation automatically.

E2E + backend: 4 new tests in
`packages/backend/src/switch-controls.test.ts` cover both write paths
+ the unwired-switch case + the no-reverse-propagation guarantee.

## Wire components from FloorEditScreen (cycle-86)

Pin: closes the cycle-85 user-flagged follow-up ("quick-create
canvas should auto-pick a slot on the linked panel — follow-up").
Per Critic ADJACENT + Devil OBJ1 + Lockin FATAL #1+#2, we DO NOT
fork a wiring surface into the FloorEditScreen sidebar. Instead the
selected-component Card gains an "Edit details" Button that opens
ComponentForm in a Modal (cycle-73 presentation="sheet" for mobile).

ComponentForm already pre-selects `floor.panelId` for the Panel
dropdown (cycle-85 `floorPanelId` prop). The user picks the slot;
no auto-pick (electrically dishonest — each circuit is a real slot
decision).

FloorEditScreen now loads `listAllBreakersGrouped` + room suggestions
on refresh (same data ComponentsScreen loads). Reuses ALL cycle-39
G31 interlocks verbatim (panel-change-clears-breaker, stale-panel
fallback, tandem-half suffix). No new endpoint, no schema change,
no divergent wiring UI to maintain.

DOM hooks: `data-testid="floor-edit-component-edit"` on the trigger
Button; `data-testid="floor-edit-component-modal"` on the Modal.

cycle-19 G19 quick-create flow UNCHANGED (components still created
with breakerId=null). The wire-from-canvas flow becomes:
  tap tool → tap canvas → pin selected → tap "Edit details" →
  Modal opens → Panel defaulted to floor.panelId → pick slot → Save.

## Cycle-84 deferred mobile polish (cycle-84)

Pin: 4 of the 6 deferred cycle-83 mobile-audit findings shipped:
- P1 #6: .component-row__actions gets padding-inline-end: --space-1
  (additive nudge so Edit/Trash don't hug the row card right edge)
- P2 #8: FloorEdit active tool styled via data-active attribute on
  the Button (NOT a new variant — Lockin #2 alternative). Uses
  existing --color-accent-subtle + --color-accent-border tokens.
  Inactive tools keep variant="ghost".
- P2 #9: PanelMap Card chrome reduced at <720px via additive
  background/border transparent + padding-inline:0. NO element
  nesting changes — preserves cycle-50 SelectionBar +
  fullBleed contract (Lockin FATAL #3 alternative).
- P2 #11: .form-actions stacks column + full-width buttons at
  <720px. Desktop unchanged.

DEFERRED (FATAL or bundle-split):
- P2 #12 ScreenHeader right reserve bump — cycle-83 just touched
  the same surface; Researcher confirmed aesthetic-only. NOT shipped.
- P2 #11 "Done" link removal — Devil OBJ4 said bundled with
  layout fix; defer.
- P2 #10 Audit Tests-h2 anchoring — small visual gap reduce only;
  h2 must remain in DOM for cycle-82 a11y baseline (aria-labelledby).
  Scope kept narrow (margin-bottom tighten via :has() + attr scope).

## Motion-easing token consumption sweep (cycle-81)

Pin: 3 bare-easing literals in styles.css converted to canonical tokens:
- L1988 .breaker-row[data-highlight='true']: ease-out → var(--motion-ease-out)
- L2077 .test-breaker--tracked: ease-in-out → var(--motion-ease-in-out)
- L4020 .floor-plan__pin[data-highlight='true']: ease-out → var(--motion-ease-out)

NOTE — curve is INTENTIONALLY snappier: native `ease-out` is
`cubic-bezier(0, 0, 0.58, 1)`; `--motion-ease-out` is
`cubic-bezier(0.22, 1, 0.36, 1)` per tokens.css. This is polish, not
regression — sharper snap matches G11 "no jarring transitions"
(VISION line 35). Visual diff is subtle on a 1.5s pulse.

Durations PRESERVED. 1.5s G23 self-clear window is load-bearing
(cycle-22 ADR).

CARVE-OUTS (intentional bare-easing literals — DO NOT TOKENIZE):
- theme-transition L173-175: bare `ease` (not ease-out/in-out — the
  cycle-22 G22 theme swap chose a softer feel for 800ms)
- he-spin L691,713: bare `linear` (uniform rotation rate)
- he-link-drag-march L4170: bare `linear` (marching-ants visual rhythm)
- he-modal-rise L3365: 220ms literal duration (cycle-73 ADR hard-pin)
- .printable-page block: full carve-out (cycle-27 G24 ADR — paper
  artifact theme-invariant)

NEW Node gate scripts/check-motion-literals.mjs (Node ESM, cycle-77
pattern) scans styles.css for `\bease-out\b|\bease-in-out\b` with
selector-scoped carve-outs. Wired via package.json `lint:motion`
script in the build chain.

NO new token NAMES (cycle-11/17/20 rule re-pinned).
HT-mapping tokens.css:27-55 untouched (FATAL #1).

## Filter primitives polish (cycle-79)

Pin: cycle-60 filter/sort primitives polished:
1. `.sort-dropdown__option` + `.filter-popover__chip` get `min-height:
   var(--touch-target)` at `@media (max-width: 720px)` only (Lockin
   alt: keep desktop density). cycle-68 already shipped 44px on
   `.combobox__option` — NOT touched again.
2. `.sort-dropdown__menu` gains `he-modal-rise` entry animation —
   parity with `.combobox__listbox` (which had it since cycle-60).
3. The L4527-4532 styles.css comment claimed bottom-sheet
   behavior that never existed — replaced with honest deferral
   note citing sheet-inside-sheet conflict (Devil FATAL OBJ2).

DEFERRED — mobile bottom-sheet for FilterPopover + Combobox listbox.
Reason: FilterPopover-nested-Combobox creates sheet-inside-sheet
stacking conflict (cycle-60 ADR #4 — Combobox is portal-mounted with
data-portal-popover for outside-click skip; if both become flex-end
sheets, the inner one renders invisible under the outer). Plus
FilterPopover has its own `useFilterPopover` outside-click hook —
NOT Modal — so cycle-73 Modal `presentation="sheet"` doesn't apply
without refactor. A future cycle may design a proper popover-sheet
primitive separate from Modal.

NO new token NAMES (cycle-11/17/20 rule).
cycle-60 `data-portal-popover` invariant preserved (Lockin FATAL #5).
HT-mapping tokens.css:27-55 untouched (FATAL #1).

## he-pulse theme fix + targeted literal sweep (cycle-78)

Pin: cycle-22 G23 + cycle-13 G13 `he-pulse` keyframe (used by
`.breaker-row[data-highlight]` + `.floor-plan__pin[data-highlight]` +
`.test-breaker--tracked` infinite pulse) had cycle-3 bootstrap sky-blue
`rgba(56,189,248,...)` literals — broken for cycle-23 G22 sage palette,
theme-invariant flash. Fixed in cycle-78 to use `--color-accent-subtle`
for background + `--color-accent-border` for the 6px box-shadow ring,
so dark + light themes both adapt automatically.

he-pulse and he-slot-pulse stay SEPARATE (Lockin #4 — different DOM
shapes, halo clipping concerns).

Targeted sweep this cycle: 7 cycle-3 sky-blue + 9 cycle-3 coral-red
rgba literals replaced with `--color-accent-*` / `--color-danger-*`
tokens at clearly-semantic sites (`.error`, `.breaker-row__actions
.danger` + `.panel-danger button.danger`, `.badge--warn`,
`.badge--count`, `.test-breaker--off`, `.map-actions__btn.danger`).
~10 sky-blue + 1 coral-red literals remain in styles.css; bulk sweep
DEFERRED (Devil + Lockin FATAL — needs per-site UX audit) to a future
cycle.

E2E coverage: `e2e/he-pulse-theme.spec.ts` — build-time grep
assertions against the styles.css source (a) no sky-blue literals in
the he-pulse keyframe block, (b) 20% peak stop uses
`var(--color-accent-border)`. Runtime browser-context assertion was
attempted but the 1.5s data-highlight self-clearing window races
Playwright's auto-wait — build-time grep is deterministic + sufficient.

DEFERRED for future cycle:
- Hex CI gate widening to styles.css (needs allow-list mechanism for
  cycle-27 G24 `.printable-page` block + cycle-69 G37
  `.printable-protection-chip` rules — both PIN literal hex on
  paper artifacts).
- Radius literal sweep (Lockin #3 — `--radius-md` is 12px but some
  8px sites are deliberate small-chip styling; per-site audit needed).
- Remaining ~10 sky-blue + 1 coral-red rgba literals in styles.css
  (component-row callout backgrounds, test-component tappable border,
  unplaced-item button border, etc.) — semantic intent isn't
  obvious-enough from context to mass-replace safely.

NO new token NAMES (cycle-11/17/20 rule).
HT-mapping tokens.css:27-55 untouched (FATAL #1).
`.printable-page` + `.printable-protection-chip` blocks UNTOUCHED
(cycle-27 G24 + cycle-69 G37 ADRs).

## EmptyState illustrations Part 2 — sweep + partition rule (cycle-77)

Pin: cycle-76's 4 illustrations now serve 8 sites total (4 Part 1 +
4 Part 2). NO new illustration art this cycle (Lockin FATAL #2 alt:
defer NoAuditTests + NoFloorForPanel to follow-up).

Newly wired (4): TestPanelScreen 'No breakers yet' (NoBreakers),
TestPanelScreen 'No components yet' (NoComponents), PanelMapScreen
'No floor for this panel yet' (NoFloors), PanelDetailScreen 'No
components wired yet' (NoComponents).

Retained-on-lucide (5, with explanatory comments above each call):
AuditScreen filtered-empty (transient), AuditScreen truly-empty
(ClipboardList semantically conveys + zero-new-art rule),
ComponentsScreen filtered-empty (transient), FloorEditScreen 'Floor
not found' (ERROR not list-empty), FloorEditScreen 'Nothing selected'
(selection placeholder + mobile-hidden per cycle-34 G28).

Partition rule codified in EmptyState.tsx JSDoc (Lockin #1
alternative): illustration = first-impression list-empty; icon =
filtered-empty | error | selection-placeholder | mobile-hidden.

Hex-literal grep gate added (Lockin FATAL #5): build chain rejects
any `#[0-9a-fA-F]{3,8}` match in `src/ui/illustrations/`. Defends
both the cycle-23 G22 HT-mapping FATAL #1 (tokens are the SSOT —
parallel hex universe banned) and the cycle-76 illustration rule.

NO new token NAMES (cycle-11/17/20 rule re-pinned).

## EmptyState illustrations Part 1 — pilot (cycle-76)

Pin: `<EmptyState illustration={<NoPanels />}>` is the optional bespoke
SVG illustration slot. `icon` (existing prop) stays valid. Slots are
mutually exclusive — provide ONE of `icon` or `illustration`.

Pilot illustrations (4) shipped in `ui/illustrations/`: NoPanels,
NoFloors, NoComponents, NoBreakers. Each is `forwardRef<SVGSVGElement>`,
viewBox 0 0 140 140, stroke=currentColor + sage accent via
`var(--color-accent)`. NO hex literals — Lockin FATAL #3 + cycle-23
G22 HT-mapping pin. NO new token NAMES — cycle-11/17/20 rule.

Pilot wired sites (4): PanelListScreen, MapLandingScreen,
ComponentsScreen truly-empty (NOT filtered-empty), PanelDetailScreen
no-breakers (NOT no-components-wired). Remaining 9 EmptyState sites
stay on the lucide-icon path — Part 2 (cycle 77+) ports them.

CSS: NEW `.empty-state__illustration` BEM class with cycle-36 G29
mobile-compact override (96px at <720px, 140px at >=720px).
Mutually exclusive with `.empty-state__icon`.

CLAUDE.md "Library choices (pinned)" — inline SVG illustration carve-out
re-pinned: "Inline SVGs are still fine for one-off illustrations
(e.g. EmptyState art)". Lucide remains canonical for ICONS.

Light + dark themes work for free via `currentColor` + token vars
(cycle-23 G22 dual-theme contract preserved).

NOT applied to: PrintableDiagramScreen (cycle-27 G24 monochrome
contract — no EmptyState used today; do not introduce).

## Tooltip primitive (cycle-75)

Pin: `<Tooltip content={...}>{trigger}</Tooltip>` is the canonical
custom-tooltip replacing native `title=""` for genuinely-informational
content. Trigger must be exactly one React element; Tooltip clones it
to thread `aria-describedby`, pointer/focus/touch handlers.

Activation: 250ms-delayed hover, immediate focus, 500ms touch
long-press (configurable via `longPressMs` prop per cycle-75 Lockin).
Dismiss: pointerleave, blur, or touch cancel.

A11y contract (Lockin FATAL #5): aria-describedby links trigger to
tooltip body; tooltip itself has role="tooltip" + id. NOT a substitute
for aria-label — aria-label remains the accessible NAME; tooltip is
the DESCRIPTION.

Portal-mounted to document.body (Lockin #2 — avoids `overflow:hidden`
clipping inside scroll containers). Position fixed; viewport-clamped
on scroll/resize via passive listeners.

Reduced-motion: fade only, no slide.

Sweep this cycle (~6 sites): .badge--critical x3 (ComponentsScreen +
TestPanelScreen + ImpactModal), three-way badge (FloorEditScreen),
View-on-floor-plan link (ComponentsScreen), Reset-zoom IconButton
(FloorEditScreen).

DELETED redundant `title=` from FloorEditScreen tool-palette Buttons
L1218-1280 (6 sites) — they already have visible labels + kbd badges.

Native `title=""` REMAINS acceptable for purely-redundant info; new
INFORMATIONAL tooltips MUST use the primitive.

NO new token NAMES (cycle-11/17/20 rule re-pinned).

Bundled: fix(cycle-75) — BreakerWithComponents.toggleExpand flipped
expanded BEFORE await so the cycle-74-shipped Spinner branch becomes
reachable on first click. Recorded as cycle-74 deferral; landed
cycle-75 as Lockin-recommended separate-first-commit.

## Button `busy` + Spinner primitive (cycle-74)

Pin: `<Button busy>` adds in-flight visual + a11y signal — leading lucide
`Loader2` spinner + `aria-busy="true"` + `data-busy="true"` + `.btn--busy`
class. It does NOT auto-disable (caller still owns `disabled`) and does
NOT replace children (label + leadingIcon remain visible to prevent
layout jitter). Wire pattern: `<Button busy={isSubmitting}
disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>`.

`<Spinner>` primitive in `ui/Spinner.tsx` is the inline loading indicator
for non-Button surfaces. Props: `size` (default 16), `label` (default
"Loading"). Wraps lucide `Loader2` + a visually-hidden screen-reader
label. role="status" aria-live="polite". Used only by
BreakerWithComponents this cycle — other bare `Loading…` sites
(PanelDetailScreen.tsx:830, FloorEditScreen.tsx:1154,
PrintableDiagramScreen.tsx:94) intentionally untouched because they're
either string-into-ScreenHeader-title (different shape) or the cycle-27
G24 monochrome ADR forbids Spinner inside `.printable-page`.

NEW keyframe `he-spin` + NEW CSS class names `.spinner` /
`.btn__spinner` / `.btn--busy` / (`.visually-hidden` if missing).
Reduced-motion carve-out: spinner static (no rotation) per Devil OBJ4
and Lockin Guard alternative — frozen-spinner reads as "stuck" to
vestibular-sensitive users.

NO new token NAMES (cycle-11/17/20 rule re-pinned).

cycle-66 G40 rule #9 ServiceLogModal `service-log-modal-submit` testid
preserved.

## Mobile bottom-sheet Modal (cycle-73)

Pin: `<Modal presentation="sheet">` is the opt-in mobile bottom-sheet
variant. Default `presentation="centered"` is byte-identical to cycle-20
G20 Modal behavior. The sheet variant ONLY pivots below 720px viewport;
desktop falls back to centered automatically.

Wired sites this cycle: ServiceLogModal, Add-→-Modal (ComponentsScreen,
PanelListScreen, MapLandingScreen). Conf/Prompt/Picker stay centered.

The drag-handle is a **functional swipe-to-dismiss affordance** (updated
2026-05, superseding the cycle-73 "decorative only" decision per user
feedback). `Modal.tsx` attaches pointer handlers to the handle: pointerdown
captures, pointermove translates the sheet down with the finger (downward
only, via inline `transform: translateY`), pointerup closes if the drag
exceeds `min(150px, 30% of sheet height)` else snaps back. The
`.modal--sheet-dragging` class suppresses the `.modal--sheet` snap-back
`transition` mid-drag so it tracks 1:1. The handle stays `aria-hidden` —
ESC + Close button + overlay click remain the accessible dismiss paths
(cycle-20 G20 ADR preserved); the swipe is a touch enhancement on top.
`min-height`/`max-height` on the shell + sheet now use `100dvh`/`85dvh`
(with `vh` fallback) so mobile browser chrome doesn't create spurious
scroll or push the fixed bottom-tabs below the fold.

NEW class names: `.modal-overlay--sheet`, `.modal--sheet`,
`.modal__drag-handle`. NEW keyframe `he-modal-slide-up`. NO new token
names (cycle-11/17/20 rule re-pinned).

cycle-66 G40 rule #9 ServiceLogModal data-testid contract preserved.
focus-trap + ESC + overlay-click + body-scroll-lock all apply to sheet
variant.

Focus-ring normalize (additive cleanup): 3 legacy `outline: 2px solid
var(--accent)` rules at styles.css:1234/1431/1839 (panel-create input,
breaker-form input+select, breaker-picker) replaced with the canonical
`box-shadow: var(--shadow-focus)` pattern used everywhere else.

## Card compound primitives (cycle-72)

Pin: `<Card>` is the surface primitive (cycle-11); cycle-72 ships sibling
exports `<CardHeader>` / `<CardTitle>` / `<CardSubtitle>` / `<CardActions>`
for in-card composition. New BEM rules `.card__header` / `.card__title`
/ `.card__subtitle` / `.card__actions`. The `.section-title` class
STAYS — it has 33+ uses outside Card and remains the canonical
section divider on non-Card surfaces.

NO `<CardBody>` / `<CardFooter>` shipped. `<Card>`'s `children` is the
body. A future cycle may add Body/Footer if real consumers need them.

`<CardActions>` docks right via `margin-left: auto`. Use for primary
buttons in the header (e.g. Done, Save).

`<CardTitle>` is polymorphic via `as`: defaults to `<h2>`; pass
`as="h3"` (or h4) when the Card sits inside a higher-level heading
(e.g. properties sidebar in FloorEditScreen).

Bespoke per-card BEM trees (`protection-aggregate-card__*`,
`floor-edit__tool-palette`) STAY bespoke — primitive is opt-in.
Sweep targets are sites that today render `<Card><h2 className="section-title">...`
or a similar first-child header pattern. 6 sites migrated this cycle:
PanelDetailScreen (Add-breaker w/ Done CardActions), FloorEditScreen
(Wall, Room, selected-component w/ Rename CardActions), AuditScreen
(Search sr-only), ComponentsScreen (Search sr-only), PanelMapScreen
(Floor plan upload sr-only). The bespoke
`.panel-detail__add-breaker-header` CSS rule was removed — `.card__header`
provides the equivalent layout.

NO new token NAMES (cycle-11/17/20 rule re-pinned).

## Form primitives (Textarea + Select) — cycle 71

Cycle-71 extracts two missing form primitives and sweeps all form sites
to use them. Pin these decisions — future cycles touching forms MUST
respect them.

1. **`Textarea` primitive** (`packages/frontend/src/ui/Textarea.tsx`)
   mirrors `Input.tsx`: `forwardRef<HTMLTextAreaElement>`, label / error
   / hint slots, `useId()` for `htmlFor`, `aria-invalid` +
   `aria-describedby` wiring. **API is register-spread compatible** —
   `{...register('note')}` works just like `<Input>`. `rows` defaults
   to 4. CSS sets `font-family: var(--text-family)` so it inherits the
   app font (NOT the browser monospace default for textareas).

2. **`Select` primitive** (`packages/frontend/src/ui/Select.tsx`) is
   **CONTROLLED, not register-spread** — cycle-50 `Checkbox` precedent.
   Generic over `<T extends string>`. API:
   `value: T | null`, `onChange: (next: T | null) => void`,
   `options: SelectOption<T>[]` OR `optGroups: SelectOptGroup<T>[]`,
   `placeholder?: string` (when provided, empty-string row maps to null
   on select — the cycle-42 G34 + cycle-68 G37 `setValueAs` boilerplate
   is hoisted into the primitive). lucide `ChevronDown` renders inside
   `.select__control` (theme-tracks instead of a background-image SVG).

3. **9 sites adopted**:
   - `BreakerForm.tsx`: poles, tandemHalf, protection, feedsSubpanel
   - `ComponentForm.tsx`: type, protection, panel, breaker
   - `BreakerPicker.tsx`: 1 select (uses `optGroups` for panel-grouped
     breaker lists)
   All four `register('x', { setValueAs: ... })` cycle-42 / cycle-68
   protection/tandemHalf incantations are gone — the primitive does it.
   Each call site uses `watch('x')` + `setValue('x', next, { ... })`
   (cycle-50 Checkbox controlled-API pattern).

4. **ServiceLogModal data-testid preservation (cycle-66 G40 rule #9
   re-pinned).** `ServiceLogModal` now uses `<Textarea>` for the note
   field. **CRITICAL**: `data-testid="service-log-modal-note"` is
   forwarded through to the underlying `<textarea>` element via the
   primitive's `...rest` spread. ALL other testids from the cycle-66
   ADR (`service-log-modal`, `-form`, `-submit`, `-close`, `-list`,
   `-item`, `-delete`, `-date`) are unchanged. The bespoke
   `.service-log-modal__note-input` CSS rule is no longer attached
   (the `.textarea__field` cascade owns rendering); the old
   `service-log-modal__field` wrapper survives as a layout shim. The
   date input stays bespoke (no `<Input type="date">` migration this
   cycle — keep ADR rule #9 byte-stable).

5. **Tandem-half nullify useEffect preserved** (cycle-42 G34 ADR rule
   #1). When `poles` changes away from 'tandem', the BreakerForm
   useEffect that calls `setValue('tandemHalf', null)` is unchanged.
   Same for the panel-→-breaker clearing in ComponentForm
   (`handlePanelChange` calls `setValue('breakerId', null, ...)`).
   The Select primitive's controlled-API is what makes these
   cross-field effects trivial.

6. **NO new token NAMES** (cycle-11/17/20 rule re-pinned). The new
   `.textarea` + `.select` BEM trees in `styles.css` mirror `.input`
   exactly (same `min-height: var(--touch-target)`, same focus ring,
   same error/hint colors). Select uses `padding-right: var(--space-8)`
   to leave room for the absolutely-positioned chevron — value-only,
   not a new token.

7. **Validation gate** (verify before any future change to form
   primitives or call sites): typecheck clean; build with PWA gz JS
   ≤ 200 KB; e2e suite (smoke, configure-page, breaker-slot-validation,
   component-wiring, service-log, component-service-log, tandem-breakers,
   three-way-switch) all green on `desktop-1440x900`.

## Single floor-creation surface (cycle-70b)

Pin: **floors are created from ONE place only — `/map` (MapLandingScreen)**
via the "Add floor" header CTA + modal (cycle-62 G42(d) Add-→-Modal
pattern). The PanelMapScreen Upload-floor-plan button only ATTACHES a
plan to an existing floor; it does NOT auto-create one.

The cycle-53b followup added a second creation path
(`PanelMapScreen.handleFileChange` auto-created a "Main Floor" when
`activeFloor === null`). Cycle-70b REVERTED that — user feedback flagged
the divergence: two creation surfaces with different UX (one explicit +
named via modal, one implicit auto-named via upload action) was
confusing. The auto-create path also bypassed the cycle-49 G42(a) UNIQUE
name retry flow.

PanelMapScreen `Upload floor plan…` button is now `disabled` when
`activeFloor === null`; the EmptyState renders a "Create a floor"
button that navigates to `/map` (cycle-44 G42(d) CTA contract).

DO NOT re-introduce auto-create from PanelMapScreen — that's a divergent
flow.

## Per-row destructive affordance (cycle-70 polish-pass-2)

Per-row Delete (or other destructive) affordances on list screens MUST
use `IconButton variant="danger"` with the `Trash2` lucide icon, NOT
the full `Button variant="danger"` text form. The icon-only form
preserves the destructive-color cue + the >=44px hit area + the
cycle-47 undoable-delete safety net while eliminating the column of
red text buttons that dominates visual attention on desktop list
views. Current consumers: `BreakerRow` (used in PanelDetailScreen
list view), `ComponentsScreen` per-component row.

The full-button form is RESERVED for solo-context destructive actions
where the destructive affordance is the ONLY thing in its row/section
— e.g. the "Delete this panel" red bar on PanelDetailScreen footer,
the "Danger zone" Delete button on FloorEditScreen. In those contexts
the action label is informational; the icon-only form would feel
under-explained.

Bulk-select selection bar (cycle-50) is the canonical surface for
high-volume / sweep deletes — when the user wants to delete N rows
in one go, the SelectionBar's "Delete N components?" confirm modal +
batched undo toast handle it. The per-row icon is for "delete this
single row right now" lightweight intent.

## GFCI/AFCI protection (G37 Part 1 — cycle-68)

Cycle-68 ships the protection schema + form pickers + Panel viz badge.
Part 2 (PanelListScreen monthly aggregate card + Print badge + PWA
Notification reminder) deferred.

Pin these decisions:

1. **Schema**: `protection TEXT NULL CHECK(protection IN
   ('gfci','afci','dual') OR protection IS NULL)` on BOTH `breakers`
   AND `components`. Frozen enum — closed app-level state with
   NEC-canonical values. Mirrors cycle-42 G34 tandem_half precedent.

2. **`protection` is on BOTH tables intentionally**: a circuit can be
   GFCI-protected at the breaker (most common) OR at the receptacle
   itself (older homes with non-GFCI breakers + a GFCI outlet at the
   first downstream receptacle protecting the rest). They're NOT
   redundant — both should be capturable.

3. **`dual` = GFCI + AFCI combined breaker** (NEC-recognized since
   2014). Single enum value rather than a separate boolean per
   protection type — keeps the schema flat + the picker simple.

4. **Cycle-42 G34 rule #7 (re-pinned)**: all SQL touchpoints for
   `breakers` AND `components` carry the `protection` column —
   SELECT/INSERT/UPDATE in `SqliteBreakerRepository.list/create/
   get/update` + `rowToBreaker` + `SqliteComponentRepository.list/
   create/get/update` + `rowToComponent` + `rowToResolvedComponent`
   + the two components table-rebuild templates
   (`ensureComponentsBreakerFkOnDeleteSetNull` +
   `ensureComponentsFloorIdColumn`) include `protection` conditionally
   via PRAGMA-check (same pattern as cycle-59 critical + cycle-19
   gangs). Future rebuild templates MUST include this column.

5. **Form pickers use the cycle-42 tandemHalf `setValueAs` pattern**:
   `setValueAs: (v) => v === 'gfci' || v === 'afci' || v === 'dual'
   ? v : null`. The placeholder `<option value="">` represents null
   so the schema's `protectionKindSchema.nullable().optional()` is
   satisfied without bouncing on an empty-string zod error.

6. **Badge surfaces (Part 1)**:
   - Panel viz: per-breaker slot cell + per-tandem-half sub-cell —
     absolutely-positioned `.panel-viz__protection-badge` in the
     top-right corner of the slot button.
   - ComponentsScreen row: when the COMPONENT has protection (via
     `c.protection`) AND when its WIRED BREAKER has protection (via
     a `breakerProtectionById` lookup map sourced from
     `listAllBreakersGrouped()` — `ResolvedBreakerSummary` does NOT
     carry `protection`, deliberately, to avoid widening the join).
   - PanelDetailScreen components-on-panel row + TestPanelScreen
     visible-when-off list reuse the same inline `<ProtectionBadge>`
     (`packages/frontend/src/components/ProtectionBadge.tsx`).
   - All renders carry `data-testid="protection-badge"` +
     `data-protection="<value>"`.

7. **Badge uses `--color-warning*` (cycle-59 G35 token family)** —
   amber safety palette, distinct from accent-subtle (sage brand)
   and danger (red destructive). NO new token NAMES added —
   cycle-11/17/20 rule re-pinned.

8. **Part 2 deferred**: PanelListScreen "N GFCI/AFCI devices haven't
   been tested this month" aggregate card + one-tap-tested-all action
   (writes one breaker_tests row per protected breaker), Print diagram
   badge, Notification.requestPermission first-of-month reminder.

## GFCI/AFCI protection — Part 2 (cycle-69)

Cycle-69 ships the remaining G37 surfaces:

1. **PanelListScreen aggregate card** — top of /panels. Computes
   protected-breakers-untested-this-month across all panels via
   `listAllBreakersGrouped()` filtered to `protection !== null` +
   `latestBreakerTestsByIds()` (cycle-61) for the latest-test
   lookup. Threshold = `new Date(year, month, 1).getTime()`. Hidden
   when count=0 (no chrome eaten when nothing to do). One-tap
   "Test all now" → `useModal.confirm()` → fan out N POST
   `/api/v1/breakers/:id/breaker-tests` with
   `outcome='monthly self-test'` + `testedAt=Date.now()` +
   `notes='Bulk-marked from monthly aggregate card'`.
   `Promise.allSettled` for partial-fail safety; full success / total
   failure / partial-fail surface as distinct toasts. Refresh runs
   after — card auto-hides when every protected breaker is
   this-month-tested. DOM hooks:
   `data-testid="panel-list-protection-aggregate-card"` +
   `data-testid="test-all-protected"`.

2. **PrintableDiagramScreen monochrome chip** — local
   `PrintableProtectionChip` component (NOT the shared cycle-68
   `ProtectionBadge` — that uses screen amber tokens). Black border
   on white, no fill, literal hex values per cycle-27 G24 ADR #4.
   CSS rule scoped inside `.printable-page` selector so it inherits
   the hard-overridden print color stack.

3. **Both breaker AND component protection render on print** when
   both are set (per cycle-68 G37 ADR #2 — they capture distinct
   real-world setups: GFCI breaker + downstream GFCI receptacle is
   a legal configuration). DOM hook:
   `data-testid="printable-protection-chip"` +
   `data-protection="<kind>"` on every render.

4. **`createBreakerTest()` API field is `testedAt`, NOT
   `occurredAt`.** The breaker_tests schema uses tested_at (cycle-61
   schema pin); the cycle-69 fan-out uses `testedAt: Date.now()`.
   Don't confuse with the cycle-66 `service_entries.occurred_at` —
   distinct table, distinct field.

5. **DEFERRED**: `Notification.requestPermission` first-of-month
   local reminder. PWA Notifications API has permission-prompt UX
   considerations (browser-level OS prompt, fingerprinting concerns,
   feature-detection on iOS Safari PWA) that warrant their own
   design pass.

## Service-log entries (G40 Part 1 — cycle-66)

Cycle-66 ships the dated service-log infrastructure + BreakerRow surface.
ComponentRow timeline + ComponentsScreen search widening DEFERRED to
Part 2.

Pin these decisions:

1. **`service_entries` schema** — id TEXT PK, parent_type TEXT NOT NULL
   CHECK(parent_type IN ('breaker','component')), parent_id TEXT NOT
   NULL, occurred_at INTEGER NOT NULL, note TEXT NOT NULL, created_at
   INTEGER NOT NULL. Index `idx_service_entries_parent` on
   `(parent_type, parent_id, occurred_at DESC)`.

2. **parent_type CHECK is defensible** because it's closed app-level
   state with exactly 2 valid values. NOT free user text — different
   from cycle-61 outcome (free text, no CHECK). Cycle-3 frozen-enum-
   when-needed precedent: adding a 3rd parent_type later (e.g. floor,
   room) requires a table rebuild. Acceptable given the parent set
   is naturally bounded by domain.

3. **No polymorphic FK** — SQLite can't enforce. Cascade is APP-LEVEL
   in 3 sites:
   - `SqliteBreakerRepository.delete()` — single breaker delete
   - `SqliteBreakerRepository.deleteByPanel()` — bulk via panel
   - `SqliteComponentRepository.delete()` — single component delete
   PLUS the inline `SqlitePanelRepository.delete()` cascade-loop (which
   flattens the breaker-delete cascade for transaction safety). All
   sites guarded by `tableExists('service_entries')` PRAGMA check
   (cycle-61 pattern).

4. **components.notes column SURVIVES** — G40 is ADDITIVE, not
   replacement. Freeform notes remain for static descriptive notes;
   service_entries adds time-stamped event log alongside. Future
   cycles MUST NOT remove components.notes.

5. **URL convention**: nested writers (URL-driven polymorphism, NOT
   body-driven) + flat query:
   - `POST /api/v1/breakers/:breakerId/service-entries`
   - `POST /api/v1/components/:componentId/service-entries`
   - `GET /api/v1/service-entries?parentType=&parentId=&parentIds=&since=&until=&limit=`
   - `DELETE /api/v1/service-entries/:id`
   Kebab-plural matches cycle-61 breaker-tests + cycle-63 audit.
   `parentIds` is the comma-separated bulk variant — PanelDetailScreen
   uses it to fetch every breaker's entries in ONE round-trip.

6. **LIMIT default = 200** matching cycle-63 DEFAULT_AUDIT_LIMIT.
   Response shape `{ data, totalCount }` matching cycle-63. Route
   clamps to 200 server-side regardless of zod's 1000 ceiling.

7. **NetworkFirst, NOT SWR.** Service entries are durable user
   records; stale reads could mislead. NOT added to vite.config.ts
   runtimeCaching allowlist — the catch-all NetworkFirst clause
   already handles them.

8. **Mobile timeline contract: ALWAYS opens in Modal**, NEVER
   inline-expanded in BreakerRow. Cycle-34/36 mobile-vertical-space
   pins enforced. The row shows a small "Log · N" badge that
   triggers `ServiceLogModal` (base Modal primitive, NOT useModal —
   parent owns open state). Below 720px the badge text stays compact.

9. **DOM contract** for e2e selectors (READ-ONLY hooks — no behavior
   depends on them, but renaming requires updating spec files):
   - `[data-testid="breaker-row-service-log"][data-breaker-id][data-log-count]` — the badge
   - `[data-testid="service-log-modal"]` — the modal root
   - `[data-testid="service-log-modal-list"]` — the entries list
   - `[data-testid="service-log-modal-item"][data-entry-id]` — each row
   - `[data-testid="service-log-modal-delete"][data-entry-id]` — delete icon
   - `[data-testid="service-log-modal-form"]` — the add-entry form
   - `[data-testid="service-log-modal-note"]` — the note textarea
   - `[data-testid="service-log-modal-date"]` — the date input
   - `[data-testid="service-log-modal-submit"]` — the Add button
   - `[data-testid="service-log-modal-close"]` — the Close button

10. **Part 2 (cycle-67) — SHIPPED.** ComponentRow timeline + search
    widening landed in cycle-67. ComponentsScreen now renders the
    same `Log · N` pill on every component row (same visual style as
    BreakerRow; CSS rules in styles.css are grouped — see
    `.breaker-row__service-log, .component-row__service-log`).
    Bulk-fetch via `?parentIds=` mirrors PanelDetailScreen. The
    `ServiceLogModal` is parent-type-generic (accepts
    `parentType: 'breaker' | 'component'`). Search now widens to
    `service_entries.note` content via an EXISTS subquery — see the
    "List filters" pin for the contract. The DOM hook
    `[data-testid="component-row-service-log"][data-target-component-id][data-log-count]`
    is the canonical e2e selector (parallel to breaker-row-service-log).
    Note the attribute name `data-target-component-id` (NOT
    `data-component-id`) — the parent `<li>` already owns
    `data-component-id` per the cycle-50 G42(f) pin, so the badge uses
    a distinct attribute to avoid the strict-mode locator collision in
    `bulk-actions.spec.ts` which queries `[data-component-id="X"]`.

## Three-way / co-controlled switches (G38 — cycle-64)

Cycle-64 ships the deferred G38 multi-switch-controls-one-light UI.
Schema (cycle-19 G19 + cycle-20 G20) already supports it; this cycle
visualizes it.

Pin these decisions:

1. **NEW flat endpoint** `GET /api/v1/switch-controls?floorId=<id>` —
   returns all controls where either the switch OR the controlled
   component is on the floor. Flat per CLAUDE.md "Reverse views"
   rule. NO per-light nested route. The route lives in
   `packages/backend/src/routes/switch-controls.ts` alongside the
   pre-existing per-switch CRUD endpoints; it queries the
   `switch_controls` table directly with a LEFT JOIN to `components`
   on both sides + a `floor_id = ? OR floor_id = ?` filter. Returns
   plain `SwitchControl[]` triples (NOT ResolvedSwitchControl) —
   the frontend already has the component data loaded for the floor.

2. **"Co-controlled" detection rule**: keyed on `controlled_id` set,
   NOT on `(switch_id, gang_index)` tuple. A light has the badge when
   `count(distinct switch_id where controlled_id === lightId) >= 2`.
   "3-way" is user-facing copy; technically ANY count >= 2 qualifies.
   Logic lives in two FloorEditScreen memos: `controlsByControlledId`
   (Map<lightId, SwitchControl[]>) → `coControlledIds` (Set<lightId>).

3. **Two distinct render branches** in the link-layer SVG:
   - selected-switch → lines for that switch's controls (existing
     forward branch, cycle-20 G20).
   - selected-light → lines from EACH controlling switch (NEW). Gated
     on `sel.type === 'light' || 'outlet'` AND
     `coControlledIds.has(sel.id)`.
   The two branches are mutually exclusive on `sel.type` so no
   double-render is possible.

4. **DOM test contract** (PINNED for future cycles):
   - `data-testid="three-way-badge"` + `data-gang-index` + `data-switch-id`
     on the small pill rendered next to each contributing gang
     handle. Hosted inside a `.gang-link-handle-group` wrapper so it
     docks alongside the existing gang button.
   - `data-testid="control-line"` (existing) — both forward and
     inverse branches use the same selector; `data-gang-index` +
     `data-controlled-id` (+ NEW `data-switch-id` on the inverse
     branch only) disambiguate.
   - `data-testid="controlled-by"` (sidebar section wrapper) +
     `data-testid="controlled-by-row"` + `data-switch-id` on each
     row of the "Controlled by" list. The single-controller case
     renders the row inline (NOT inside a list); both forms share
     the `controlled-by-row` testid + `data-switch-id` attr.

5. **Drag-to-link contract UNCHANGED.** Cycle-20 G20 drag-flow is
   additive — multi-source-to-one-light emerges from independent gang
   drags from different switches. NO drag-source semantics change.

6. **"Controlled by" sidebar replaces the placeholder stub** at the
   FloorEditScreen selected-component branch (was `void controlledBy`
   pre-cycle-64). Renders only when `sel.type === 'light' || 'outlet'`
   AND the controlled component has >= 1 controller. Single-controller
   case is a one-line inline render; multi-controller (the actual
   "3-way" case) is a list of clickable rows.

7. **Mobile clutter mitigation (Devil OBJ4)**: `.three-way-badge__text`
   hides below 720px (cycle-36 G29 narrow-fold breakpoint), leaving
   only the lucide `GitFork` icon next to the gang handle. The badge
   stays discoverable but doesn't crowd the canvas. See e2e
   `three-way-switch.spec.ts` mobile-clutter screenshot test.

8. **Floor-wide state stays in sync with mutations.** Two state
   atoms in FloorEditScreen: `switchControls` (per-selected-switch,
   pre-cycle-64) and NEW `floorSwitchControls` (per-floor flat feed).
   When the user adds/removes links via the per-switch sidebar OR via
   the drag-to-link flow, BOTH atoms are updated mirror-style so the
   3-way badge + Controlled-by list react immediately without a
   refetch.

## Audit screen (G36 Part 2 — cycle-63)

Cycle-63 ships the deferred `/audit` route from the cycle-61 G36 ADR.
Pin these decisions — future cycles touching the audit surface or the
breaker-tests API MUST respect them.

1. **Route `/audit` is FLAT** (not panel-scoped) and AppShell-wrapped
   (NOT escape-hatch). House-level history view; future per-panel
   drill-downs use `?panelId=`, NOT a nested route. Lives inside the
   AppShell `<Switch>` in `App.tsx` — bottom tabs + theme toggle stay
   visible.

2. **No 4th bottom-tab.** Audit is accessed via TestPanelScreen footer
   link only (the "View audit log" Link with the ClipboardList icon).
   The 3-tab Panels/Components/Map layout is pinned via cycle-34 G28
   mobile-overflow spec — adding a 4th tab would break that contract.

3. **LIMIT 200 default on `GET /api/v1/breaker-tests`.** Response shape
   is now `{ data: BreakerTest[], totalCount: number }` (was just the
   array). The screen renders "Showing the most-recent N of M tests.
   Filter to see older entries." when `totalCount > data.length`. The
   route caps to `DEFAULT_AUDIT_LIMIT = 200` even if a caller passes a
   higher `?limit=` (zod schema bounds to 1000, route clamps to 200).

4. **NEW index `idx_breaker_tests_tested_at`** on `tested_at DESC` —
   added in `openDatabase` alongside the cycle-61
   `idx_breaker_tests_breaker_id_tested_at` composite. The composite
   is not optimal for an UNFILTERED global ORDER BY (it's leading-edge
   on breaker_id). Both indexes coexist; both are additive
   `CREATE INDEX IF NOT EXISTS`.

5. **`BreakerTestListFilter` adds `until?: number` + `limit?: number`.**
   `until` is inclusive epoch ms upper bound (`tested_at <= ?`). The
   `BreakerTestRepository.list()` return changed from
   `Promise<BreakerTest[]>` to `Promise<BreakerTestListResult>` where
   `{ data, totalCount }`. Consumers `latestByBreaker` (internal) and
   `latestBreakerTestsByIds` (frontend) updated to read `.data`. NO
   other backend code paths consume `list()` directly.

6. **`useFilterState('he.audit-filter', defaults)`** — follows the
   cycle-60 `he.<screen>-filter` localStorage naming template. State
   shape: `{ since, until, outcome, breakerId, sortBy, sortOrder }`.
   `search` lives separately (debounced 250ms, NOT persisted; matches
   ComponentsScreen behavior).

7. **Audit GETs stay NetworkFirst** — NOT added to the SWR allowlist
   in `vite.config.ts`. The audit-trail data is the user's permanent
   verification record; stale reads would mislead them about what's
   been tested recently. Mutations still hit network; reads fall
   through to the catch-all NetworkFirst entry already in place.

8. **Date range filter uses native `<input type="date">`** for v1.
   Both `since` (lower) and `until` (upper) bounds supported
   server-side. epoch-ms conversion at change time:
   `dateInputFromEpoch` / `epochFromSinceInput` /
   `epochFromUntilInput`. The `until` helper bumps to end-of-day
   (23:59:59.999) so "until 2024-01-31" includes events recorded at
   23:50 on that day. NO date-fns/dayjs/luxon dependency — native
   Date + Intl.DateTimeFormat only.

9. **Outcome filter is a typeahead Combobox** of distinct outcomes
   derived from the LOADED tests (mirrors ComponentsScreen Room
   pattern). Disabled when no outcomes yet. **Breaker filter is a
   Combobox of ALL breakers** (sourced from `listAllBreakersGrouped()`
   — accepts the N+1 cost; ComponentsScreen already pays it).

10. **Click-through deep-link uses the cycle-22/23 contract:**
    `/panels/<panelId>#breaker-<breakerId>` pulses the matching slot
    cell in the panel viz. The audit row's `data-testid="audit-row-link"`
    is the canonical hook for e2e selectors. Future producers of
    "show me this breaker" links MUST use the same hash format.

11. **E2E lives at `e2e/audit-screen.spec.ts`** — desktop-only (the
    popover-anchored Combobox + date inputs interact better at the
    wider viewport). Mobile rendering is covered by
    `mobile-overflow-triage.spec.ts` via the `screens[]` array — when
    adding a new top-level route, add a new entry there (cycle-34 G28
    pinned rule).

## Add-→-Modal pattern (cycle-61f + cycle-62)

The cycle-61 followup (ComponentsScreen) and cycle-62 (PanelListScreen,
MapLandingScreen) converged on a single pattern for "Add X" forms on
list-style screens: a header CTA opens a base `Modal` containing the
form, instead of an always-visible `Card` consuming half the viewport.
Pin these decisions — future "Add X" surfaces on list screens MUST
follow this pattern.

1. **Wrapper is the BASE `Modal` primitive from `ui/Modal.tsx`, NOT a
   `useModal()` call.** The base Modal is a separate render surface;
   it has no replace-policy collision with `useModal()`'s singleton
   (cycle-20 G20 ADR #2). This matters whenever the create handler
   ALSO uses `useModal().prompt()` — e.g. PanelList + MapLanding both
   call `prompt()` recursively on a 409 from the backend to offer a
   suffixed candidate. If the wrapper were a `useModal()` call, the
   409 prompt would replace+close it mid-create, dropping the user's
   typed name. **Do not convert these wrappers to `useModal()` in a
   future cycle.**

2. **State shape**: a single `const [addXOpen, setAddXOpen] = useState(false)`
   on the screen. The ScreenHeader CTA flips it on; the create handler
   flips it off on success; Cancel + Close (X) + overlay click flip it
   off via Modal's onClose.

3. **DOM contract**:
   - ScreenHeader trigger: `data-testid="open-add-<resource>"` (e.g.
     `open-add-panel`, `open-add-floor`, `open-add-component`).
   - Modal: `testId="add-<resource>-modal"`.
   - EmptyState CTA (when present): `data-testid="empty-state-add-<resource>"`.

4. **Excluded sites (cycle-44 — UPDATED cycle-62).** The cycle-44
   G42(d) EmptyState CTA sweep deferred PanelListScreen +
   MapLandingScreen because their create-form sat directly above the
   EmptyState (the adjacency-rule exception). Cycle-62 moved those
   forms into header-triggered Modals, removing the adjacency. Both
   "No panels yet" + "No floors yet" EmptyStates NOW have a primary
   "Add X" CTA. Still EXCLUDED from EmptyState CTAs:
   - **PanelDetailScreen** "No breakers yet" — create-form still
     inline above (port to this pattern is a future cycle's call).
   - **FloorEditScreen** "Nothing selected" — passive sidebar
     placeholder, mobile-hidden, no analogous CTA.

5. **EmptyState copy avoids "above"** for screens that adopted the
   pattern. Old: "Add your first panel above…". New: "Use the Add
   panel button in the header to…". The "above" phrasing becomes a
   lie once the form moves into a modal.

## Breaker-test audit trail (G36 — cycle-61)

Cycle-61 ships the durable test-event record. G7's walk-through is no
longer ephemeral — every "Mark verified" writes a row.

Pin these decisions:

1. **`breaker_tests` schema** — id TEXT PK (ULID), breaker_id TEXT
   NOT NULL FK ON DELETE CASCADE, tested_at INTEGER (epoch ms),
   outcome TEXT NULL, notes TEXT NULL, created_at INTEGER NOT NULL.
   Index `idx_breaker_tests_breaker_id_tested_at(breaker_id,
   tested_at DESC)` for fast "latest per breaker" lookups.

2. **outcome is FREE TEXT — NOT an enum.** Per the cycle-3 "Component
   types are frozen" precedent — DB CHECK enums are expensive to
   change later (SQLite table rebuild). Outcome is a label users
   write; formalize via enum only after real usage shows clear
   buckets.

3. **Cascade = ON DELETE CASCADE** at the FK level + belt-and-
   suspenders `DELETE FROM breaker_tests WHERE breaker_id = ?` in
   `SqliteBreakerRepository.delete()` + `deleteByPanel()`. Test
   history is meaningless without the breaker; deleting the breaker
   drops its history. Slot-level history continuity (delete+recreate
   in same slot) is NOT preserved — different breaker IDs = different
   histories.

4. **"Mark verified" is an EXPLICIT button**, NOT a side-effect of
   the off-set toggle. The cycle-7 G7 off-set is ephemeral (cleared
   on visibilitychange + 10s); conflating verification with flipping
   would couple two orthogonal flows. The new button is at the
   breaker-row level in TestPanelScreen.

5. **URL convention**: nested write — `POST /api/v1/breakers/:breakerId/breaker-tests`;
   flat query — `GET /api/v1/breaker-tests?breakerId=&since=&outcome=`.
   Matches cycle-1 URL pin.

6. **Audit GETs are NetworkFirst, NOT SWR.** Audit data is fresh-on-
   read; don't add to `vite.config.ts` runtimeCaching SWR allowlist.

7. **No new deps.** Relative time via native `Intl.RelativeTimeFormat`
   in `lib/relativeTime.ts:formatRelative(epochMs)`.

8. **Warn dot** uses `--color-warning*` (cycle-59 G35 token family).
   "Never verified" → dot. ">12 months ago" → dot. Otherwise muted.

9. **`/audit` screen DEFERRED.** VISION marks it "Optional"; ship the
   table + write path + read hint first. A follow-up cycle adds the
   route with filterable list.

## Filter + sort UX system (ported from HousesTracker — cycle-60)

Cycle-60 lifts HT's hand-rolled filter+sort primitives into House Electricals.
The user-directed motivation: typeahead dropdowns for filters whose valid
values are a known finite set (e.g. "filter by room"), instead of
exact-match text input.

Pin these decisions:

1. **Primitives in `ui/` (lifted from HT, token-translated)**:
   `FilterPopover`, `FilterTriggerButton`, `Combobox<T>`, `SortDropdown`.
   Hooks: `useFilterPopover`, `useComboboxKeyboard`. Tailwind classes
   translated to House Electricals tokens per the cycle-11 design-system
   rule. **No new token NAMES** — values only via existing tokens
   (`--color-bg-surface-raised`, `--color-border-strong`, `--shadow-lg`,
   `--radius-md`, `--color-accent-subtle`, `--color-accent-border`,
   `--color-bg-hover`).

2. **State management = lightweight `useFilterState<S>`** —
   localStorage-only, no URL sync, no reducer. (HT uses URL +
   localStorage + reducer; House Electricals doesn't need URL-deep-linkable
   filters yet. Add URL sync in a future cycle if needed.) Shallow-
   merges over defaults on read, so adding a new field in a later
   cycle doesn't break older serialized state.

3. **Combobox is single-select v1.** Multi-select port defers to a
   future cycle. Single-select covers the user's named pain (Room
   typeahead). The generic API accepts `value: T | null` so widening
   to `value: T[]` later is a parameter widening, not a rewrite.

4. **Listbox is portal-mounted to `document.body`** with
   `data-portal-popover` attribute. The `useFilterPopover` outside-
   click handler skips elements with this attribute so opening a
   Combobox inside a FilterPopover doesn't close the parent.

5. **First consumer: ComponentsScreen.** Replaces the exact-match
   text input for Room with a Combobox of distinct room values from
   loaded components. Type filter migrates from native `<select>` to
   a chip row inside the FilterPopover. Sort UI is NEW (was server-
   canonical only) — sorts CLIENT-SIDE over the server-filtered
   list. Storage key: `he.components-filter`. Sort defaults to
   `created/asc` (matching the cycle-44 server canonical sort, so
   "do nothing" behavior is byte-identical to pre-cycle-60).

6. **Search input + URL `?search=` contract unchanged** (cycle-44/47
   debounce + URL replace). Only the room+type+sort state migrates
   to localStorage. The cycle-44 G42(d) filter-active vs truly-empty
   branch split in ComponentsScreen now consumes
   `searchInput || filterRoom !== null || filterType !== null` via
   the `hasAnyFilter` memo.

7. **Other screens migrate in future cycles.** PanelListScreen,
   Components-on-panel filters, TestPanelScreen, etc. stay on the
   old controls until their own port cycle. The primitives are
   ready to consume from any screen.

8. **DOM test contract for the new primitives** (e2e selectors):
   - `[data-testid="components-filter-toolbar"]` — the pill toolbar
   - `[data-testid="components-filter-trigger"]` — the Filter pill
   - `[data-testid="components-filter-popover"]` — the popover panel
   - `[data-testid="filter-type-chip"][data-value="<type>"]` — chips
   - `[data-testid="filter-room-combobox"]` — Combobox wrapper
   - `[data-testid="filter-room-combobox-trigger"]` — Combobox button
   - `[data-testid="filter-room-combobox-listbox"]` — portalled list
   - `[data-testid="combobox-option"][data-value="<v>"]` — options
   - `[data-testid="components-sort"]` + `-trigger` / `-menu`
   - `[data-testid="sort-dropdown-option"][data-sort-by][data-sort-order]`
   Future cycles touching these MUST preserve the contract; new
   primitive consumers add their own scoped testids on top.

## components.critical flag (G35 Part 2 — cycle-59)

Closes G35 entirely. Cycle-58 ADR #2 deferred this from Part 1.

Pin these decisions:

1. **`components.critical INTEGER NOT NULL DEFAULT 0`** — additive
   ensureColumn migration (with `CHECK(critical IN (0,1))`). SQLite
   bool-as-int convention (cycle-19 G19 `components.gangs` precedent).
   `rowToComponent` maps to `critical: row.critical === 1`. The two
   `components` table-rebuild templates (`ensureComponentsBreakerFkOn
   DeleteSetNull` + `ensureComponentsFloorIdColumn`) include `critical`
   AND `gangs` conditionally via PRAGMA-checks so a future rebuild
   doesn't drop them.

2. **`--color-warning*` token family is NEW** — base, hover, subtle,
   border for both dark + light themes. NOT from the HousesTracker
   palette (HT has only sage/coral); House Electricals-original amber.
   Cycle-21 G21 ADR #8 explicitly allows net-new tokens; named
   clearly + documented in tokens.css. Dark: `#d97706` family; light:
   `#b45309` family (slightly deeper amber for AA on cream canvas).

3. **Critical-first sort INSIDE each room group** of the cycle-58
   Impact modal — preserves the floor→room grouping ADR. Critical
   items bubble to top of their room; non-critical follow,
   alphabetical. Does NOT lift critical into a separate top-of-modal
   section (would break the grouping). The room-array sort lives
   inline in `ImpactModal.tsx`.

4. **ComponentForm checkbox uses `watch('critical')` +
   `setValue('critical', next)`** (NOT register-spread). The cycle-50
   `<Checkbox>` primitive is controlled — mirror the existing
   `breakerId` pattern. Default `critical: false` is seeded in
   useForm defaultValues (create form) and values (edit form).

5. **Badge surfaces**: ComponentsScreen row, ImpactModal item,
   TestPanelScreen visible-when-off list. Same `.badge--critical`
   class everywhere. Text "Critical" with a lucide AlertTriangle
   icon (size=11, strokeWidth=2.5). `data-testid="badge-critical"`
   on every render — the test-hook contract for future cycles.

## Impact modal (G35 Part 1 — cycle-58)

Cycle-58 ships the "what dies if I flip this breaker?" Impact modal —
one-tap triage view per breaker row.

Pin these decisions:

1. **NO switch_controls transitive edge.** VISION G35's wording
   ("transitively via switch_controls — switches on this breaker pass
   through to the lights/outlets they control") is electrically wrong:
   switches are signal logic, not power supply. Killing a switch's
   breaker means you can't toggle the light from that location, but
   the light still has power from ITS OWN circuit. The Impact modal
   shows ONLY (a) direct components (components.breakerId === selected)
   and (b) recursive cascade via cycle-57 computeCascadeOff (subpanel
   feeder chains — actual power propagation). A future cycle MAY add
   a separate "Switches that lose control" surface, but it does NOT
   belong in the Impact "loses power" modal.

2. **components.critical flag DEFERRED to Part 2** — schema migration +
   UI toggle + warn-orange badge + criticality sort ship in a follow-up
   cycle.

3. **Pure helper `lib/impact.ts`** — `computeImpact(breakerId, ...)`
   returns ImpactItem[] with reason: 'direct' | 'cascade' + optional
   viaSubpanel attribution. Reuses cycle-57 computeCascadeOff
   internally (offSet = single-breaker Set).

4. **Read-only modal** — no UI state change, no "simulate flip" toggle.
   The Impact modal is a precomputed snapshot; TestPanelScreen remains
   the interactive walkthrough surface.

5. **BreakerRow Impact button is icon-only on mobile** (lucide Zap) +
   text label "Impact" at ≥720px. Mitigates BreakerRow mobile row
   wrap pressure.

## Subpanel breaker-test recursion (G39 Part 2 — cycle-57)

Cycle-57 ships the deferred Part 2 of G39: TestPanelScreen's
"what loses power" walkthrough now recurses DOWNWARD through
`panels.parent_breaker_id` chains. Pin these decisions — future
cycles touching this surface MUST respect them.

1. **Downward only.** The user flips off a feeder breaker on the panel
   they're testing — all subpanel + sub-subpanel components are marked
   lost-power. Upward recursion (testing from a SUBPANEL screen and
   surfacing its parent's feeder for toggling) is OUT OF SCOPE this
   cycle. A future Part 3 could expose an "upstream feeders" mini-
   section on subpanel test screens so the operator can flip a parent
   panel's breaker without leaving the subpanel test page.

2. **Direct-off wins over cascade-off.** A component whose own breaker
   is toggled off renders "Currently off" — same as cycle-56 and
   earlier. A component whose breaker is cascade-off (some feeder
   upstream is in the off-set) renders a "via <Subpanel Name>" chip
   ADDITIONALLY in the same state slot. If BOTH apply (own breaker is
   off AND it's also downstream of an off feeder), DIRECT wins — NO
   chip — because the user already knows that breaker is off. The
   render rule lives in TestPanelScreen as `cascadeVia` per-component:
   `!offBreakers.has(c.breakerId) && cascade.cascadeBreakerIds.has(...)`.

3. **2-pass BFS walker.** `packages/frontend/src/lib/subpanelRecursion.ts`
   exports `computeCascadeOff(offBreakerIds, allPanels, breakersByPanel)`:
   - Pass 1: seed the frontier with panels whose own `parentBreakerId`
     is in `offBreakerIds`. BFS-expand by adding any panel whose
     parent breaker is owned by an already-cascaded panel. Result:
     `offPanelIds` = every panel whose feeder chain ends at an off
     breaker.
   - Pass 2: collect every breaker in those panels (minus the direct-
     off ones — precedence). Attribute each cascaded breaker id to
     its containing panel's name for the chip.

4. **Data fetch widens.** `TestPanelScreen.refresh()` adds one call to
   `listAllBreakersGrouped()` (already-existing helper in `api.ts`,
   also used by ComponentsScreen) so the walker has the full house's
   panel + breaker tree. State shape adds `allPanels: Panel[]` and
   `breakersByPanel: Map<string, Breaker[]>`.

5. **G14 off-state-invariance preserved.** The `offBreakers` Set
   stays a single global Set per-mount — unchanged from cycle-14. The
   cascade derivation is a memoized read of that Set + the panel/
   breaker tree; it does not write to `offBreakers`. Floor switcher
   still narrows the displayed component list only.

6. **Cycle safety.** Cycle-56 server-side validation rejects parent
   chains that would form a cycle, but the walker has a belt-and-
   suspenders depth cap (`allPanels.length + 1`) so a corrupted-
   state cycle in the DB cannot infinite-loop the BFS.

7. **Cascade chip CSS.** `.test-component__cascade-chip` is muted
   (uses `--color-fg-muted` + `--color-bg-hover` + `--color-border-
   subtle`), NOT the alarming red of the `Currently off` badge. The
   mental model: the component is off because of an UPSTREAM flip,
   not its own breaker — a softer visual is correct. Token NAMES
   unchanged (only existing tokens reused; cycle-11/17/20/22 rule
   re-pinned).

8. **E2E coverage:** `e2e/subpanel-recursion.spec.ts` (3 tests × 2
   mobile + 1 desktop project) — seeds its OWN scratch fixture via
   the REST API (does NOT modify the global `seed.ts` fixture so
   other specs are unaffected). Asserts: (a) feeder off →
   cascade chip on subpanel components + "Currently off" badge,
   (b) root-panel-non-feeder component is untouched, (c) restore
   feeder clears the cascade.

## Subpanel hierarchy (G39 — cycle-56)

Part 1 of G39 ships the LINK + viz + tree. Part 2 (impact view / breaker-test
recursion through subpanels) is DEFERRED.

Pin these decisions:

1. **`panels.parent_breaker_id`** is a nullable TEXT FK to `breakers(id)` with
   `ON DELETE SET NULL`. Index `idx_panels_parent_breaker_id` supports the
   reverse lookup (which panels does this breaker feed?). Top-level panels
   have parent_breaker_id = null. The column is added via the
   `ensurePanelsParentBreakerIdColumn` migration: ALTER ADD COLUMN first,
   then a panels-table rebuild attaches the FK action (the ALTER form of
   `REFERENCES … ON DELETE SET NULL` is parsed but NOT enforced by SQLite
   — same pattern as `ensureComponentsFloorIdColumn`).

2. **Cycle detection** is server-side on POST/PATCH (`routes/panels.ts:
   validateParentBreakerLink`). A panel cannot feed itself, and chains like
   A→B→A (or deeper A→B→C→A) are blocked at the route layer with a 400.
   Walk: from the candidate feeder breaker's owning panel, follow
   parent_breaker_id up the chain; if you encounter the panel being
   wired, return an error. Bounded by `allPanels.length + 1` depth so a
   corrupted-state cycle in the DB can't infinite-loop the validator.

3. **Cascade on breaker delete = DETACH (SET NULL)**. The FK ON DELETE SET
   NULL is the DB-level invariant. Belt-and-suspenders app-level UPDATE
   lives in `SqliteBreakerRepository.delete()` AND `deleteByPanel()` AND
   the bulk-cascade in `SqlitePanelRepository.delete()` — all three sites
   run `UPDATE panels SET parent_breaker_id = NULL WHERE parent_breaker_id
   = ?` (or `IN (SELECT id FROM breakers WHERE panel_id = ?)` for bulk)
   before deleting the breaker(s). Guarded by a `PRAGMA table_info` column
   check so the repo stays usable before the migration runs.

4. **Link UX = BOTH surfaces**:
   - BreakerForm has a "Feeds subpanel" `<select>` (edit-existing only —
     the breaker needs an id to be referenced; not shown on Add). The
     control writes to PANELS.parent_breaker_id, not the breaker — the
     `onChangeFeedsSubpanel` callback in PanelDetailScreen calls
     `updatePanel(subpanelId, { parentBreakerId: thisBreakerId })`.
   - PanelDetailScreen has a "Fed by" card with a cascading picker:
     first pick the parent panel, then pick which breaker on it. Tandem
     breakers are filtered out of the breaker picker.
   Either flow writes to the same `panels.parent_breaker_id` field.

5. **Tandem halves are not valid feeders.** UI greys out the "Feeds
   subpanel" picker when poles === 'tandem' AND filters tandem breakers
   out of the "Fed by" breaker picker. Server doesn't enforce this (a
   future tightening), but the UI guides toward correct usage.

6. **PanelListScreen renders a hierarchical tree.** Root panels (parent =
   null OR orphaned parent breaker) sit at top level; subpanels nest under
   their parent panel inside `.panel-list__subpanels` with a leading
   `<CornerDownRight>` marker + "Slot N: Label" feeder hint. Recursive
   render via the `PanelTree` component — supports arbitrary depth even
   though typical homes are 1-2 levels. Sort: roots by createdAt; children
   by createdAt under their parent.

7. **PanelVisualization shows a "→ Subpanel Name" chip** on every feeder
   breaker slot. The chip is a `<span role="link">` (NOT a wouter `<Link>`)
   to avoid nesting interactive elements inside the slot `<button>` —
   navigation is imperative via `useLocation` from wouter. Click is
   `stopPropagation`'d so the slot button's onClick (open breaker editor)
   doesn't also fire. The map `subpanelsByFeederBreakerId: Map<breakerId,
   Panel>` is built on PanelDetailScreen from `allPanels` filtered by
   `parentBreakerId` pointing at one of THIS panel's breakers. For tandem
   pairs, the chip lands on whichever half is the feeder (single-half
   feeders are unusual electrically but legal).

8. **Recursion in impact / breaker-test LANDED in cycle-57**. See
   "Subpanel breaker-test recursion (G39 Part 2 — cycle-57)" above —
   TestPanelScreen now cascades an off feeder through subpanel chains
   via the `computeCascadeOff` helper in
   `packages/frontend/src/lib/subpanelRecursion.ts`. Upward recursion
   (testing from a subpanel and toggling its parent's feeder) remains
   deferred.

## Bulk-actions on ComponentsScreen (G42(f) — cycle-50)

Cycle-50 adds row multi-select + sticky selection bar with "Assign breaker"
and "Delete" actions on `/components`. Pin these decisions — future cycles
touching the bulk-actions surface MUST respect them.

1. **N sequential PATCHes via `useOptimisticPatch`**, NOT a backend bulk
   endpoint. Per Lockin OBJ1: bulk endpoints fork the write path and
   commit to a public API surface; client-side fan-out reuses the
   pinned optimistic queue + per-row error reporting for free. The
   bulk Assign handler in `ComponentsScreen` calls `bulkAssign.patch(id,
   { breakerId })` in a `Promise.allSettled` loop; partial failures
   surface as a count-of-failures toast + a `refresh()` to roll back
   the optimistic UI for the failed rows.

2. **`useMultiSelect<T>` API shape PINNED** (`packages/frontend/src/hooks/useMultiSelect.ts`).
   Signature: takes `readonly T[]` where `T extends { id: string }`,
   returns `{ selectedIds: ReadonlySet<string>, isSelected, toggle,
   selectAll, clear, selectedItems, count }`. State is `Set<string>` of
   IDs (NOT array, NOT `Map<id, T>`). Auto-prunes ids removed from
   `items` between renders. No persistence (localStorage / URL). No
   range / shift-select in v1.

3. **Selection bar REPLACES bottom-tabs while active**, not stacks.
   `body:has(.selection-bar) .bottom-tabs { display: none; }` — the
   cycle-28/36 mobile-vertical-space pins are preserved (no extra
   reserved height). Selection bar fills the same footprint as
   bottom-tabs (`--layout-bottom-tabs-h` + `env(safe-area-inset-bottom)`).
   Mount via `createPortal(<SelectionBar … />, document.body)` from
   the consuming screen — keeps the bar at the document root so the
   `body:has(.selection-bar)` CSS selector matches reliably.

4. **Bulk delete keeps the confirm modal**, even though single-row
   delete (cycle-47 ADR) dropped it. Bulk delete is destructive enough
   that the cycle-20 `useModal.confirm()` prompt + the cycle-47-style
   undo tray together is the right level of friction. Confirm asks
   count ("Delete N components?"); batched undo toast says "Deleted N
   components" with a single Undo button.

5. **Bulk undo uses a single shared timer + toast** —
   `useUndoableDelete` exposes `deleteManyWithUndo(opts)` (sibling to
   cycle-47's `deleteWithUndo`). Per-id entries land in the same
   `pendingDeletes` queue (so an in-flight bulk survives a route
   change) but they all share the same `timer` and `toastId`.
   `Promise.allSettled` fires N per-id commits at T+30s; cancelling
   any one entry `clearTimeout`s the shared timer (subsequent
   `cancelPendingDelete` calls are idempotent no-ops). On commit-time
   failure: all-fail restores everything; partial-fail also restores
   everything and surfaces "X of N failed" — disambiguating failed-
   from-succeeded rows after an optimistic blanket-removal is hard,
   so the safe move is full rollback + refresh.

6. **`Checkbox` UI primitive is token-only** (`packages/frontend/src/ui/Checkbox.tsx`).
   Token VALUES + a new `.checkbox` CSS class are added; NO new token
   NAMES (cycle-11/17/20 rule preserved). The entire `<label>` wrapper
   is the >=44px hit area via `padding: var(--space-2)` +
   `min-height: var(--touch-target)`. The native `<input>` is visually
   hidden but stays screen-reader-announced; the visible `.checkbox__box`
   reads from `--color-bg-input` / `--color-border-strong` and on
   checked switches to `--color-accent` + the `--color-fg-on-accent`
   check glyph.

7. **Component row carries `data-testid="component-row"` +
   `data-component-id` + `data-selected`** so e2e selectors can
   target individual rows without relying on the row's text content.
   The row Checkbox carries `data-testid="component-row-checkbox"`.
   These are READ-ONLY hooks (no behavior depends on them) — future
   cycles can rename/remove them but only by updating
   `e2e/bulk-actions.spec.ts` in the same change.

8. **Bulk-actions for the Unplaced sidebar (FloorEdit) is DEFERRED**
   to a follow-up cycle. The Unplaced sidebar lives in a 3-column
   desktop layout under different vertical constraints (sticky panel,
   no bottom-tabs in floor-edit at all since it's an AppShell-escape
   route) — needs its own selection-bar mounting strategy. Change-room
   as a third bulk action is also deferred (the picker needs a
   "free-text room name OR existing room" affordance that doesn't
   exist yet).

## Unplaced sidebar bulk-actions (G42(f) part 2 — cycle-51)

Pin: the Unplaced sidebar lives in `PanelMapScreen.tsx`, NOT
FloorEditScreen. PanelMapScreen is an AppShell-inside route (with
`fullBleed={true}` — see App.tsx), so the cycle-50 `body:has(.selection-bar)
.bottom-tabs { display: none }` rule fires correctly and SelectionBar
mounts via `createPortal(document.body)` exactly like ComponentsScreen.

Row structure REFACTORED from
`<li><Button drag-handlers>content</Button></li>` to
`<li><span.unplaced-item__select><Checkbox/></span><Button drag-handlers>content</Button></li>`
— Checkbox is a SIBLING of the drag-target Button (valid HTML; the
drag's `setPointerCapture(pointerdown)` on the Button doesn't swallow
the checkbox click because they're not in a parent-child relationship).
The Checkbox's wrapping label has its own >=44px hit area via padding
+ `min-height: var(--touch-target)` (cycle-50 primitive contract).

The cycle-50 `useMultiSelect` + `deleteManyWithUndo` + `SelectionBar`
primitives are reused verbatim. PanelMapScreen now also calls
`listAllBreakersGrouped()` from its `refresh()` (added the call to the
existing `Promise.all`) so the bulk "Assign breaker" picker can offer
cross-panel options — same option shape as ComponentsScreen.

E2E coverage: `e2e/unplaced-bulk-actions.spec.ts` (4 tests × 2 mobile
projects + desktop = 12 runs). Each test FIRST creates fresh
unplaced/unwired components via REST (the seed places all 8) so the
Unplaced sidebar has rows to drive. New stable DOM hooks:
`data-testid="unplaced-item"`, `data-component-id`, `data-selected`,
`data-testid="unplaced-item-checkbox"`. The cycle-50 hooks
`data-testid="selection-bar"`, `bulk-assign`, `bulk-delete` are reused.

Toaster theme binding is RECORDED as a deferred micro-cycle (not
shipped in cycle 51 — Critic flagged SCOPE_CREEP). A second RECORDED
bug: FloorEditScreen is an AppShell escape-hatch route, so its ~27
`toast()` calls fire into a void (no Toaster mounted under the
escape-hatch tree). Both deferred.

## UNIQUE name constraints (G42(a) — cycle-49)

Cycle-49 introduces UNIQUE-name constraints for the three "user-facing
container" tables. Pin these decisions:

1. **SQLite UNIQUE indexes** on `panels(name)`, `floors(name)`,
   `rooms(floor_id, name)`. Index names (do not rename): `idx_unique_panels_name`,
   `idx_unique_floors_name`, `idx_unique_rooms_floor_name`. Created in
   `openDatabase` after the column migrations but BEFORE `backfillFloorsFromPanels`,
   inside one transaction. Idempotent: if all three indexes exist the migration
   bails immediately; otherwise it dedups missing-index tables in the same
   transaction and recreates only the missing indexes.

2. **`components.name` is EXPLICITLY EXCLUDED** from UNIQUE constraint.
   Components are house-scoped with three nullable parents (`breaker_id`,
   `floor_id`, `room TEXT`) — no canonical parent FK. The G19 quick-create
   per-floor-per-type counter ("Outlet 1", "Light 1") would collide globally,
   and a per-floor uniqueness would lock users out of "Living Room Lamp" on
   floor A and floor B. Decision deferred until an ADR clarifies
   components.name parent semantics.

3. **Pre-migration dedup**: existing duplicate rows are auto-suffixed
   with " (2)", " (3)", ... BEFORE each UNIQUE index is created. The FIRST
   row (lowest `created_at`, then lowest `id`) keeps its name; the rest get
   suffixed. If a candidate suffix also collides (e.g. "Foo", "Foo",
   "Foo (2)"), the counter increments until a free slot is found. Implemented
   in `ensureUniqueNames()` inside `packages/backend/src/repository.ts`.
   Migration is single-transaction; rollback-on-failure.

4. **Backend 409 envelope unchanged**: `{ error: { message: "Name 'X' is
   already taken." } }`. NO new `suggested` field — preserves existing
   `ApiError` shape across `@he/shared` (cycle-49 council Devil OBJ2 — would
   force a 4-layer type widening). The helper `routes/unique-name.ts` exports
   `isUniqueConstraintError()` (sniffs `err.message.includes('UNIQUE
   constraint failed')`) + `uniqueNameTakenBody(name)`. Both POST and PATCH
   handlers for panels/floors/rooms wrap their DB writes in try/catch and
   surface 409 on UNIQUE; everything else re-throws so the framework's 500
   path handles it. PATCH only returns 409 when `patch.name !== undefined`
   (a UNIQUE violation on a non-name PATCH is a programmer bug — re-throw).

5. **Frontend retry pattern**: each create/rename flow catches `ApiHttpError`
   with `status === 409` and:
   - Toasts "Name "X" is taken — try "Y"?" using `suffixDuplicate(X)`.
   - Re-prompts via `PromptModal` with the suggested name as `defaultValue`.
   - User can accept the suggestion or type their own.
   - Recurses if the next attempt ALSO 409s.
   The `suffixDuplicate(name)` helper lives in
   `packages/frontend/src/lib/duplicateName.ts` (regex
   `/^(.*) \((\d+)\)$/` → bump N; otherwise append " (2)"). Sites wired:
   `PanelListScreen` (create), `MapLandingScreen` (floor create),
   `FloorEditScreen` (floor rename, room create, room rename),
   `PanelMapScreen` (room create). `api.ts` exports `ApiHttpError extends
   Error` carrying `status` + `detail` — instances of which are thrown by
   every failing API call.

6. **Idempotency guarantee**: re-running `openDatabase` against an
   already-migrated DB is a no-op for `ensureUniqueNames`. The function
   first reads `sqlite_master` for the three target index names — if all
   present, it returns without entering the transaction. This must remain
   true: a future change that drops an index without removing the others
   from the bail-set would silently re-suffix rows that are already valid.

7. **E2E + test data**: the e2e seed already uses unique names ("Main
   Panel", "Main Floor", "Kitchen" + "Living Room" on the same floor —
   distinct, OK). `packages/backend/src/repository.test.ts` includes a
   migration-dedup test that drops the indexes, inserts duplicates manually,
   then reopens to verify suffixing. Future tests that need to assert "a
   user can create N panels named X" MUST use distinct names.

## Undoable delete (G42(c) — cycle-47)

Cycle-47 introduces a 30-second undo window for destructive deletes
(Component, Breaker, Component-from-FloorEdit). The actual server
DELETE is DEFERRED — held by a setTimeout for 30s — and fires only if
the user does not click "Undo" on the sonner toast. Clicking undo
cancels the timer (no server traffic). Pin these decisions:

1. **Model is DEFERRED-DELETE, not delete-then-recreate.** Recreating
   on undo would mint new ULIDs (breaks cycle-22/23 `#breaker-<id>`
   hash deep-links + the cycle-7 `#pin-<id>` contract) and lose the
   `switch_controls` ON DELETE CASCADE rows the backend dropped.

2. **`packages/frontend/src/lib/pendingDeletes.ts` is the canonical
   singleton queue.** Module-level `Map` keyed by resource id. Survives
   React-tree unmount so a user can navigate from `/components` to
   `/panels/:id` mid-undo-window without dropping the pending delete.

3. **Tab-close orphans are accepted** for the single-user LAN PWA.
   If the user closes the tab during the 30s window, the optimistic UI
   removal "reappears" on next load (server still has the row). This is
   defensible — no data loss — and adding `fetch keepalive` on
   `beforeunload` is deferred to a future cycle.

4. **The toast is the tray.** No new floating UI component. sonner via
   `ui/toast.ts` is the canonical surface (cycle-11 G11 pin).

5. **Confirm modals are DROPPED for the 3 wired sites** (Component
   list delete, Breaker delete, Component-from-FloorEdit delete). One-
   tap + undo replaces the confirm-then-execute pattern. The cycle-20
   G20 modal ADR is NOT violated — that ADR bans `window.confirm`, not
   confirm-before-delete-as-a-policy. ConfirmModal stays in use for
   Panel + Floor deletes (cascade semantics — those will need a
   per-site undo design in a future cycle).

6. **Generic `useUndoableDelete<T>` hook.** Same shape works for any
   resource. Adding a new site = wire the hook; do NOT fork the queue
   logic.

## Tandem-as-two-circuits (G34 — cycle-42)

The cycle-42 G34 work fixes the data model: a tandem breaker is NOT one
device — it's two single-pole circuits sharing one stab. The user's quote
("tandem breaker need to be treated as 6a and 6b, cause they are really
2 circuits in the end") is electrical reality. Pin these decisions —
future cycles touching the breaker data model, slot validation, or panel
viz MUST respect them.

1. **`breakers.tandem_half TEXT CHECK(tandem_half IN ('a','b') OR
   tandem_half IS NULL)`.** Added via additive migration in
   `openDatabase`. The CHECK constraint is the database-level invariant;
   `tandemHalfSchema = z.enum(['a','b'])` (nullable optional) in
   `@he/shared` mirrors it at the API + form layer. **Cross-field rule
   (enforced both client and server):** `poles === 'tandem'` ⇒ tandemHalf
   is 'a' OR 'b'; `poles !== 'tandem'` ⇒ tandemHalf MUST be null. The
   backend PATCH path forces tandemHalf=null when poles changes away from
   tandem, and BreakerForm has a useEffect mirror.

2. **One-shot backfill — `UPDATE breakers SET tandem_half='a' WHERE
   poles='tandem' AND tandem_half IS NULL`.** Runs once in `openDatabase`
   after the column add. Legacy tandems (pre-G34) become 'a' so they
   remain valid; users can create the 'b' partner later. **Do not change
   the backfill to 'b'** — the convention is "first tandem = a".

3. **`validateSlotAssignment` (backend `routes/breakers.ts`) tandem
   rules.** Per slot, build an occupancy map: `{ id, flavor: 'full' |
   'tandem-a' | 'tandem-b' }[]`. Rules:
   - Tandem ('a' or 'b') CANNOT land on a slot already holding a
     non-tandem (single OR double-pole) breaker.
   - Same-half collision (e.g. two 'a' on slot 6) is rejected.
   - One 'a' + one 'b' on the same slot IS the happy path — the only
     slot that legally holds two breakers.
   - Double-pole spanning slot N → N+1 still blocks both slots (no
     tandem can squeeze in).
   The PATCH gate widens to include `patch.tandemHalf !== undefined` so
   editing just the half re-runs validation. **Frontend mirrors this
   logic** in `BreakerForm.buildOccupancy` + `validateSlot` so the user
   sees the error before submit.

4. **BreakerForm tandem-half picker registration** uses `setValueAs: (v)
   => v === 'a' || v === 'b' ? v : null` so the placeholder option's
   empty-string value normalizes to `null`. **Do not remove this** — it
   makes the friendly validate-fn error fire ("Tandem breakers must pick
   a half") instead of zod's raw "Invalid enum value" message.

5. **Panel viz tandem render: split sub-cell pair.** When a slot has any
   tandem breaker (one half or both), `PanelVisualization` renders a
   `.panel-viz__slot--tandem-pair` container (NOT a button — a `<div
   role="group">`) with TWO stacked sub-cells inside. Each sub-cell is
   its own focusable `<button>` carrying `id="slot-cell-<breakerId>"` +
   `data-testid="slot-cell"` + `data-breaker-id` + `data-tandem-half`.
   The cycle-22/23 hash deep-link contract (`#breaker-<id>` pulses
   `#slot-cell-<id>`) STILL works per half. **Do not collapse to a
   single button.** The whole point of G34 is two clickable circuits.

6. **All display surfaces append the tandem-half suffix.** Slot label
   reads "Slot 6a" / "Slot 6b" for tandems, plain "Slot 6" otherwise.
   Updated in: `BreakerRow`, `ComponentsScreen` breaker chip,
   `TestPanelScreen` row, `PanelMapScreen` selection callout,
   `ComponentForm` + `BreakerPicker` `formatBreaker` helpers. **Future
   surfaces that display a breaker slot MUST append `${tandemHalf ??
   ''}`** when poles is tandem.

7. **`tandem_half` column is INSERT-explicit + SELECT-explicit across
   all repository queries.** Adding a new query that touches breakers
   MUST include the column in its SELECT list AND any INSERT body.
   `rowToBreaker` + `rowToResolvedComponent` are the mapper boundaries —
   both already include tandemHalf.

8. **E2E coverage**: `e2e/tandem-breakers.spec.ts` (5 tests × 2 mobile
   projects + desktop) covers picker visibility, no-half rejection,
   collision-with-single-pole, two-halves-share-slot-render, API-level
   same-half collision (400). Future changes to tandem semantics MUST
   keep this spec green or update it explicitly with an ADR comment.

## Panel viz mobile fold + compact EmptyState (G29 — cycle-36)

The cycle-34 G28 work missed a real mobile bug the user hit: a horizontal-
orientation panel viz with 24 slots renders 12 columns × 96px = 1152px
wide. The cycle-24 `.panel-viz--horizontal-scroll` wrapper adds horizontal
scroll — but on a 390-wide phone the user sees only slots 1-8 and doesn't
know to swipe. Cycle-36 fixes this AND tightens the EmptyState. Pin these
decisions — future cycles touching the panel viz or empty states MUST
respect them.

1. **`PanelVisualization` has a `useNarrowViewport()` hook** that returns
   true at `matchMedia('(max-width: 719px)')`. It listens for resize
   events so an in-app rotation flips orientation automatically.

2. **`displayOrientation` is what the render uses, NOT `panel.orientation`.**
   On narrow viewports `displayOrientation = 'vertical'` regardless of
   the panel's configured orientation. The canonical `panel.orientation`
   stays on the panel row — Print (G24), desktop viz, and any future
   consumer that needs the user's chosen physical layout still see it.
   Span style for double-pole breakers adapts to `displayOrientation` so
   the visual span direction matches the rendered grid.

3. **The `.panel-viz--horizontal-scroll` wrapper is skipped when display
   goes vertical.** Wrapping a folded-to-vertical viz in a horizontal
   scroller would add useless horizontal padding. The conditional in
   `PanelVisualization` checks `displayOrientation === 'horizontal'`, not
   `panel.orientation`.

4. **The 720px breakpoint is intentionally narrower than the 960px
   desktop-pivot used elsewhere.** A tablet at 768-959px CSS-wide CAN
   comfortably display 12 horizontal columns + scroll. Below 720px we
   always fold. The two breakpoints (720 + 960) are deliberate — do not
   collapse them.

5. **`.empty-state` is compact below 720px.** padding `--space-8` →
   `--space-4`, icon 56→36px, title `--text-size-lg` → `--text-size-base`,
   description `--text-size-base` → `--text-size-sm`. New first-time-user
   nudges still render (they're useful), just less bulky.

6. **`mobile-360x780` Playwright project** catches narrow-iPhone-class
   viewports (Mini, SE, Display Zoom on) the `mobile-390x844` project
   misses. Both projects now run for every mobile-flagged spec. Adding a
   new spec? Use `info.project.name !== 'desktop-1440x900'` to skip
   desktop — runs on both mobile projects.

## Mobile responsiveness (G28 — cycle-34)

The cycle-34 G28 work fixed visible mobile-overflow issues surfaced when the
user tried the deployed app on his phone. Pin these decisions — future
cycles touching the mobile surface MUST respect them.

1. **The ThemeToggle is `position: fixed; top-right; z-index: 60`.** Any
   `.screen-header` action area (Floor plan button, Rename button, etc.) on
   the right side would render BEHIND it. Mitigation lives on the header
   itself: `.screen-header` now has `padding-right: calc(var(--touch-target)
   + var(--space-3))` (~56px) which reserves the right edge for the toggle.
   **Do not remove this padding** without also rethinking ThemeToggle
   placement.

2. **Header link-actions are `white-space: nowrap; flex-shrink: 0`.** The
   "Floor plan", "Rename", etc. CTAs at the right of ScreenHeader stay
   intact at any width.

3. **`packages/frontend/e2e/mobile-overflow-triage.spec.ts` is the
   permanent regression spec.** Walks every primary screen at 390×844,
   screenshots them to `.screenshots/mobile-overflow-<Name>.png`, asserts
   `documentElement.scrollWidth <= window.innerWidth + 1`. Auto-skips at
   the desktop-1440x900 project. **Future polish cycles MUST keep this
   spec green** — and add a new entry to the `screens[]` array whenever
   they introduce a new top-level route.

4. **`@media (max-width: 959px)` is the canonical mobile breakpoint.**
   Established by G15 (cycle-16, desktop-canvas pivot) and reaffirmed by
   G28. Mobile-specific overrides go inside this media query. Do not add
   competing breakpoints (e.g. 768px, 600px) without an ADR — the dual
   breakpoint causes layout drift.

5. **Vector-only floor canvases ignore aspect-ratio on mobile.** Below 960px,
   `.floor-edit__canvas .floor-plan--vector-only` has `aspect-ratio: auto;
   min-height: min(70vh, 600px)`. Image-backed floors (with .floor-plan__img)
   still respect their image's natural aspect via the inline `style`.

6. **`.floor-edit__props > .empty-state` hides at mobile.** The "Nothing
   selected" sidebar placeholder creates a huge blank gap below the canvas
   on phones. Hidden at `< 960px`. Selection cards (`.card` direct children
   of `.floor-edit__props`) still render normally.

7. **Tool palette at mobile drops the kbd-badge + dividers.** Below 960px:
   `.tool-palette` wraps row, each `<li>` is `flex: 0 1 auto`, `.kbd-badge`
   is `display: none` (no keyboard on a phone), and `.tool-palette__divider`
   hides. Result: 4-5 tool buttons fit one row at 390px, the 6-tool palette
   wraps to 2 clean rows instead of 4 broken rows.

## Production deploy (G27 — cycle-33)

The cycle-33 G27 work replicates the HousesTracker deployment artifacts so
House Electricals can ship to the user's server (push-to-main → CI builds images
→ server pulls and restarts). Pin these decisions — future cycles touching
the deploy surface MUST respect them.

1. **Two compose files, two intents.** `docker-compose.yml` (cycle-3 origin)
   is the **build-from-source** flavor — used for local testing and
   first-time setup. `compose.prod.yaml` (new cycle-33) is the
   **registry-based** flavor — used on the production server, pulls
   pre-built images from the Gitea Container Registry. The CI pipeline
   builds and pushes; the server only needs `compose.yaml` (copied from
   `compose.prod.yaml`), `.env`, and `scripts/deploy.sh`. **Do not collapse
   them into one file** — the build: vs image: distinction is the whole
   point.

2. **One container, one image, pinned name**: `house-electricals`. Internal
   port `3000`, host port `${HOST_PORT:-8070}`. Both compose files must
   agree on container name + port. The cycle-33 split-into-two-containers
   (backend + nginx web) was collapsed into a single Hono process — see
   "Single-image consolidation" below for the contract.

3. **Registry path is `ghcr.io/${OWNER}/house-electricals` (where `${OWNER}` is
   the GitHub user/org owning the fork — set via `IMAGE` in `.env` on the
   server).** Image tags: `latest` (moves with main) + the full commit SHA +
   any `vX.Y.Z` git tag. The `:<sha>` tags are the rollback substrate — see
   docs/CI-CD-SETUP.md Part 8. Don't switch to short SHAs without updating
   that doc.

4. **CI pipeline lives at `.github/workflows/release.yml`.** Triggers on
   push to `main` (or any `vX.Y.Z` git tag) + manual `workflow_dispatch`.
   Push uses the default `GITHUB_TOKEN` (no PAT) authenticating against
   GHCR via the workflow's `packages: write` permission. The optional
   deploy step (documented in `docs/CI-CD-SETUP.md` Part 6) consumes
   `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY` repo secrets and SSHes
   the server. The DEPLOY_KEY is restricted via `command=` in the
   server's `authorized_keys` so it can ONLY run `/srv/house-electricals/deploy.sh`.
   Even if the key leaks, no shell access.

5. **`scripts/deploy.sh` is the ONLY thing the deployer user can run.**
   Sequence: `docker compose pull && docker compose up -d --remove-orphans
   && docker image prune -f`. Each line prefixed with `[deploy] …` for CI
   log visibility. `set -e` so any failure aborts.

6. **`DEPLOYMENT.md` is the user-facing entry point.** Covers both local
   build-from-source and the CI/server flavor. `docs/CI-CD-SETUP.md` is the
   step-by-step setup guide for first-time CI wiring (deployer user,
   Gitea Actions runner, secrets). Both reference each other — keep them
   in sync if the contract changes.

7. **DATA_PATH ownership on Linux: UID 65532.** The backend runs as
   distroless `nonroot` (UID 65532). On a fresh Linux DATA_PATH the user
   must run `sudo chown -R 65532:65532 <path>` once. Documented in:
   README.md, DEPLOYMENT.md, docs/CI-CD-SETUP.md Part 1.4. Windows Docker
   Desktop / WSL2 / macOS users skip this step — the VFS layer handles
   ownership. **Do not change the UID without updating all three docs +
   the Dockerfile base image choice.**

8. **Healthcheck endpoint is `/api/v1/health` returning `{data:{ok:true}}`.**
   Both compose files reference it via `node -e fetch(…)`. The backend
   route is `packages/backend/src/routes/health.ts`. If the route ever
   moves or changes shape, BOTH compose healthchecks need updating.

## Floor-map polish (G26 — cycle-32)

The cycle-32 G26 work tightens the floor editor's UX around rooms and
component pins. Pin these decisions — future cycles touching this
surface MUST respect them.

1. **Room ↔ component auto-binding is a FRONTEND concern.** The helper
   `packages/frontend/src/lib/roomLookup.ts` exports `findRoomForPoint(rooms, x, y)`
   and `findPointsInRect(items, rect)`. Both use **inclusive** axis-aligned
   point-in-rect tests (a pin exactly on a wall counts as inside). When
   placing a component (quick-create OR drag-place), call the helper and
   set `components.room = <room.name>`. **Never overwrite a user's
   manually-set room** — only auto-fill when the field is currently null.

2. **Room translate gesture lives on the room hit-rect.** A first
   pointerdown selects the room; a SECOND pointerdown (room already
   selected) begins a translate drag via `useRoomEditor.startTranslateDrag`.
   Corner handles are checked first (their pointerdown stops propagation
   before the hit-rect sees it), so corner-drag still resizes. Do NOT
   introduce a separate "move handle" icon — the rect body IS the handle.

3. **Translate-with-components is per-component PATCH, not bulk.** When
   a room translates by (dx, dy), the screen handler PATCHes the room
   first, then PATCHes every component whose pin was inside the OLD rect.
   Failures roll back per-component (one bad write doesn't undo the others).
   This matches the cycle-N use-optimistic-patch policy elsewhere.

4. **In-flight translate uses `displayedRooms` + `displayedComponentsOnFloor`
   memos.** Canonical state (`rooms[]`, `componentsOnFloor[]`) stays at
   the pre-drag values until pointerup commit. The render reads
   memo'd "displayed" arrays that apply the live drag delta. This is
   what makes per-component PATCH rollback clean.

5. **Pin visual size = 32px; hit area ≥ 44px via `::before`.** Token rule:
   the pin's `width / height` are 32px CSS pixels, with `.floor-plan__pin::before`
   absolute-positioned at `inset: -6px` to expand the effective hit
   surface. lucide icon `size={14}` matches. Don't grow the pin without
   matching the icon.

6. **Control-line + drag-line values are tokenless polish.** `.floor-plan__control-line`:
   stroke-width 16, dasharray 60/40, opacity 0.55. `.floor-plan__link-drag`:
   stroke-width 14, dasharray 50/30. `.floor-plan__link-drag--valid` is the
   only success-state escalation. These are CSS literals (not tokens) —
   they're per-surface visual tuning, not design-system primitives.

7. **Room label = uppercase + tracked, font-size 200 viewbox-units.**
   Halo stroke 60. font-weight 500. Selected-room label fills with
   `--color-accent`. Verified by `floor-map-polish.spec.ts` font-size
   assertion.

8. **Frontend unit tests live next to source as `*.test.ts` (cycle-32 first).**
   `roomLookup.test.ts` uses Node's `node:test`. There's no `test:unit`
   script wired yet because the frontend doesn't ship `tsx` as a devDep;
   run via `packages/backend/node_modules/.bin/tsx --test <path>` (or add
   the dep when a second consumer shows up).

## Design system (G11)

The frontend uses a token-driven design system. Read this section before adding any UI.

### Tokens — single source of truth

`packages/frontend/src/ui/tokens.css` defines every color, spacing, type, radius, shadow, motion value the app may use. Imported once from `main.tsx` *before* `styles.css` so every component sees the variables.

**Rule: NEVER hard-code a color/spacing/radius/shadow/motion value in a component. Read the token.**

Token families and example names (the file is the authoritative reference, but these names are pinned — future cycles must not rename without an ADR):

- `--color-bg-{canvas|surface|surface-raised|hover|input|overlay}`
- `--color-fg-{default|strong|muted|subtle|on-accent}`
- `--color-border-{subtle|strong|focus}`
- `--color-accent` + `--color-accent-{hover|active|subtle|border}`
- `--color-danger` + `--color-danger-{hover|subtle|border}`
- `--color-success` + `--color-success-{subtle|border}`
- `--space-{0|1|2|3|4|5|6|8|10|12|16}` — 4px base scale
- `--text-family`, `--text-family-mono`
- `--text-size-{xs|sm|base|md|lg|xl|2xl}`
- `--text-weight-{regular|medium|semibold|bold}`
- `--text-leading-{tight|snug|normal}`
- `--radius-{sm|md|lg|xl|pill}`
- `--shadow-{sm|md|lg|focus}`
- `--motion-duration-{fast|base|slow}` + `--motion-ease-{out|in-out}`
- `--touch-target` (44px, WCAG / iOS minimum)
- `--layout-max-w`, `--layout-bottom-tabs-h`

`@media (prefers-reduced-motion: reduce)` overrides all `--motion-duration-*` to `0ms`. Components don't need to check the media query themselves — they just read the duration tokens and respect is automatic.

### Library choices (pinned)

- **Icons: `lucide-react`** is the canonical icon library. Do not introduce a second icon set. Inline SVGs are still fine for one-off illustrations (e.g. EmptyState art), but anything that conceptually *is* an icon (action button, tab, type badge) uses lucide.
- **Toasts: `sonner`**, but consumed via `packages/frontend/src/ui/toast.tsx`. **Never import from `sonner` directly anywhere outside `ui/toast.tsx`** — that file is the swap point. If we change toast vendors, only `ui/toast.tsx` and the `<ThemedToaster />` mount point change.
- The `<ThemedToaster />` is mounted exactly once, in `main.tsx` (inside
  ThemeProvider, OUTSIDE the route Switch). This makes toasts reachable
  from escape-hatch routes (FloorEdit, /print) too. The single-mount +
  single-swap-point invariants are preserved — only the LOCATION changed.
  `ThemedToaster` calls `useTheme()` and binds sonner's `theme` prop to
  the user's resolved `he.theme` (light/dark), so toasts always match the
  app's theme instead of falling back to OS `prefers-color-scheme`.
  Updated cycle-52.

### AppShell escape hatch

The map-drawing editor (G12) eventually needs a full-bleed canvas. The escape hatch is **routing-level, not a `fullBleed` prop**: routes that need to bypass AppShell live *outside* the AppShell-wrapped `<Switch>` in `App.tsx`. This keeps the AppShell API tiny and prevents prop drilling for "is this screen special."

### Token values updated in cycle-17 (G17)

The G17 visual refresh changed token VALUES — names stayed pinned (per the CLAUDE.md rule). What was tuned:
- **Backgrounds**: warmer near-black palette (canvas `#0e1117`, surface `#161b22`, raised `#1f2632`, hover `#232b39`). Surfaces now stand out clearly from canvas.
- **Foreground muted**: `#9aa4b0` (bumped from `#94a3b8`) for AA contrast on the new canvas.
- **Borders**: `--color-border-subtle` `#2d3441` (more visible than cycle-11 `#243049`).
- **Accent**: `#58a6ff` (refined GitHub-blue family; was sky `#38bdf8`). Reads better on dark surfaces.
- **Type**: `--text-size-2xl` bumped 28→30px; `--text-size-xl` 22→23px; `--text-size-lg` 18→19px. `--text-leading-tight` 1.2→1.18; `--text-leading-snug` 1.35→1.4. NEW `--text-tracking-tight: -0.011em` for display headings.
- **Radii**: `--radius-md` 10→12px; `--radius-lg` 14→16px; `--radius-xl` 20→22px.
- **Shadows**: now multi-stop (e.g. `--shadow-md` is two layered drops) for refined depth instead of a single blur.
- **Card primitive**: gains a subtle top-edge highlight via `::before` gradient.
- **Button primary**: gains an inset highlight + drop shadow for a more tactile press feel.

AA contrast verified inline in `tokens.css` for the critical text/bg pairs. Token *names* are unchanged — no screen needed a rewrite.

### Performance budget metric (pinned)

"Initial PWA gzipped JS" = sum of the entry-chunk gzip sizes printed by `vite build` (the `gzip:` column in stdout). Service worker (`sw.js`) and the workbox runtime are excluded — they're cached separately and don't block first paint. Budget: **≤ 200 KB**. Every cycle that ships UI must rerun the build and verify.

## G24 printable diagram (cycle-27)

The cycle-27 G24 work ships the **secondary user goal**: a print-optimized panel diagram the user prints once and tapes inside their physical electrical panel door as a permanent paper reference.

1. **`/panels/:id/print` is an AppShell escape-hatch route.** Mounted in `App.tsx` alongside `/floors/:id/edit` — matched BEFORE the AppShell `<Switch>` so the print page has zero app chrome (no bottom tabs, no theme toggle, no nav). Same pattern; same hook (`isFloorEdit || isPrint`).

2. **Dual-mode CSS — paper-like on screen AND in print.** `.printable-page` renders as a centered white card with `box-shadow` on the dark canvas when viewed in a browser, so "Print to PDF" produces an attractive PDF without invoking a real printer. `@media print` rules then strip the shadow + margins + center-positioning so a real printer gets full-bleed letter-paper output.

3. **`@page size: letter; margin: 0.5in`.** US-letter default. International users get whatever default their browser/printer driver decides — overriding `@page size: A4` is a one-line ADR future task.

4. **Dark-theme tokens are hard-overridden inside `.printable-page`.** Background `#ffffff`, color `#111111`, slot borders `#999` — all hex-literals, NOT `var(--color-*)`. The theme can be dark/light/system on the rest of the app; the print view is always black-on-white. This is intentional — a paper artifact should not change with the user's theme preference.

5. **No interactive elements.** The print view has no buttons, no links,
   no JavaScript-driven state beyond the initial data fetch. It's a
   static artifact. `ComponentTypeIcon` renders SVGs from lucide
   (rendered server-style, no event handlers). (Note cycle-52: the
   hoisted `<ThemedToaster />` mount technically creates an ARIA-live
   notification region inside the print route's DOM, but
   PrintableDiagramScreen makes ZERO `toast()` calls, and sonner's host
   is invisible until a toast fires. The cycle-52 `print.spec.ts`
   extension asserts `[data-sonner-toast]` has count 0 on
   /panels/:id/print to lock this in.)

6. **Slots always render in 2-column vertical layout on paper**, regardless of the panel's `orientation` value. The screen panel-viz can be horizontal for the workflow; the printed diagram is always paper-grid (matches what the user sees on the physical panel door — a stacked rectangle).

7. **Print spec is `e2e/print.spec.ts`** — verifies `.bottom-tabs` and `.theme-toggle` have COUNT 0 (escape-hatch isolation confirmed).

## G25 UX overhaul (cycle-24)

The cycle-24 G25 work answers user feedback: "I don't see the page where I can select a component, see the panel on the side and see on click of the component which slot highlights." The cycle-22 G23 hash consumer was already wired; cycle-24 builds the producer surface so users actually have a screen to use it from.

1. **`PanelDetailScreen` is the canonical "configure" page.** It now hosts BOTH the breaker management UI AND the Components-on-panel list grouped by slot. Above 960px viewport: side-by-side (components left, panel viz right) so click → slot pulse is a one-glance gesture. Below 960px: stacked. **Do not split this into two separate routes** — the user explicitly asked for ONE page where they can pick a component and watch the slot highlight.

2. **Click-to-highlight stays a pure URL-hash interaction.** The new Components-on-panel rows set `window.location.hash = '#breaker-<id>'` (NOT `Link`-style navigation). The cycle-22 hash consumer + cycle-21 `hashchange` listener pulses the matching `slot-cell-<id>` in the panel viz on the right. URL pathname stays `/panels/:id` throughout. No `wouter` navigation; the URL contract (cycle-7) is preserved.

3. **Horizontal panel-viz mode now scrolls instead of clipping.** `.panel-viz--horizontal-scroll` wraps the grid with `overflow-x: auto`; the grid keeps `repeat(cols, minmax(96px, 1fr))` so each slot retains a sensible width. Wide panels pan laterally instead of overflowing the right edge. Vertical mode is unchanged.

4. **Test mode (G7 walk-through) lives in the page footer, not the header.** Per user feedback ("Test mode looks useless") the entry has been de-emphasized from the top-of-page button row to a footer link next to "Configure panel", with an explainer line ("Flip breakers, tag what loses power") so first-time users know the workflow before clicking in. The route + behavior are unchanged — only the discoverability + framing.

5. **Sticky left-column on desktop.** Above 960px, `.panel-detail__left` is `position: sticky; top: var(--space-4)` so the components list stays visible while the user scrolls the (potentially long) panel viz. Below 960px stacking, no stickiness.

6. **Floor plan link stays prominent in the header.** It's a high-value cross-link (component placement vs. wiring) and gets the top-right slot in `ScreenHeader` children.

7. **`components-on-panel-item` is the test-hook DOM contract.** Each tappable component row carries `data-testid="components-on-panel-item"` + `data-component-id` + `data-breaker-id`. The group header is a `button` (also clickable to highlight the slot). Future cycles MUST preserve these attrs — the e2e in `configure-page.spec.ts` depends on them.

## Design system v3 — HousesTracker palette (G22 — cycle-23)

The cycle-23 G22 work swaps the cycle-17 cool-blue dark palette for HousesTracker's warm earthy palette + adds a light theme + ThemeProvider context. Token NAMES stay pinned (cycle-11/17/20 rule); VALUES are new. Pin these decisions — future cycles touching the palette MUST respect them.

1. **The sibling HousesTracker project's `client/src/index.css` is the source of truth for the palette values.** (Locally checked out by the original maintainer; not part of this repo. The actual values are reproduced verbatim in `packages/frontend/src/ui/tokens.css` so this repo is self-contained — you don't need access to HousesTracker to build or modify House Electricals.) When tuning, read the values already in `tokens.css` and consult the mapping table below. Do not invent new hex values without an ADR.

2. **House Electricals token name ← HousesTracker concept mapping (LOAD-BEARING — per Lockin FATAL #1).** Documented as a comment block at the top of `tokens.css`. Reproduced here so it survives an accidental tokens.css rewrite:
   ```
   --color-bg-canvas         ← HT --color-background
   --color-bg-surface        ← HT --color-card
   --color-bg-surface-raised ← HT --color-popover (or +lift)
   --color-bg-hover          ← HT --color-accent (neutral tint, NOT brand)
   --color-bg-input          ← HT --color-input
   --color-bg-overlay        ← warm scrim derived from --color-foreground
   --color-fg-default        ← HT --color-foreground
   --color-fg-muted          ← HT --color-muted-foreground
   --color-fg-on-accent      ← HT --color-primary-foreground
   --color-border-subtle     ← HT --color-border
   --color-border-focus      ← HT --color-ring (= --color-primary)
   --color-accent            ← HT --color-PRIMARY  (sage green — THE BRAND)
   --color-danger            ← HT --color-destructive  (warm coral)
   --color-success           ← HT --color-success (= --color-primary)
   ```
   **CRITICAL gotcha**: HousesTracker `--color-accent` is a *neutral surface tint* (#f5f0eb / #302e29), NOT the brand. House Electricals `--color-accent` IS the brand → pull from HT `--color-primary` (sage), NEVER from HT `--color-accent`. Getting this wrong turns every Button.primary, link, focus ring, and selected-tab cream-beige instead of sage.

3. **Default theme is `'dark'`. Storage key is `he.theme`.** ThemeProvider in `contexts/ThemeContext.tsx` reads `localStorage.getItem('he.theme')` on mount, defaults to `'dark'` if absent. Three modes: `'light' | 'dark' | 'system'`. **Do not rename the storage key** — collisions with other apps' theme keys (HousesTracker uses `centris_theme`) would be very confusing. Default-light is an ADR.

4. **Light mode shadow tokens re-tuned in cycle-53 (G42-polish-pass-resolved).**
   The `:root.light` block now overrides `--shadow-sm/md/lg/tabs` with
   light-theme-appropriate alphas (~0.04-0.10 range, neutral-warm tint)
   so depth reads correctly on the cream canvas. The cycle-23 G22
   `TODO(G22-polish)` markers are removed. Future shadow tweaks per-theme
   ship inside the same `:root.light` block (or the dark `:root` for dark
   tweaks).

5. **The smooth `theme-transitioning` class has carve-outs for heavy surfaces.** `.floor-plan`, `.floor-plan *`, `.panel-viz`, `.panel-viz *`, and `svg`/`svg *` all get `transition: none !important` during the 850ms theme swap window so the canvas + visualization don't stutter on mobile. If a future heavy surface lands (e.g. a large data table), add it to the carve-out list.

6. **Plus Jakarta Sans is self-hosted via `@fontsource/plus-jakarta-sans` (MIT).** 4 weights (400/500/600/700), Latin subset. Imported from `main.tsx` BEFORE `tokens.css`. **No Google Fonts CDN** — the LAN-only deployment must not depend on outbound network at runtime. Inter remains the metric-compatible fallback. Adding additional weights or scripts requires a perf-budget recheck (current CSS gz: 17.49 KB including the @font-face declarations).

7. **The ThemeToggle (`ui/ThemeToggle.tsx`) is the canonical theme switch.** Top-right fixed position so it's reachable from every screen without prop-drilling through ScreenHeader. Cycles dark → light → system → dark. Future cycles may add a richer Settings page that subsumes it, but the floating toggle stays as the primary affordance until then.

## G23 click-to-highlight (cycle-22)

The cycle-22 G23 work ships the **core daily-use goal**: tap a component → see the controlling breaker pulse-highlighted on the panel visualization. Pin these decisions — future cycles touching the deep-link contract MUST respect them.

1. **Reuse the cycle-7-pinned `#breaker-<id>` hash format.** Do NOT add a parallel query-param contract (e.g. `?breaker=...&highlight=true`). The hash is the single producer-consumer contract; cycle-22 extends the consumer, not the URL shape. Any future producer of a "highlight this breaker" link MUST use `#breaker-<id>` — same as ComponentsScreen does today.

2. **`PanelVisualization` breaker slot button carries `id="slot-cell-<breakerId>"` + `data-testid="slot-cell"` + `data-breaker-id`.** This is the hash consumer's primary target in viz mode. Additive — empty/hidden slots are unchanged.

3. **The hash consumer auto-switches view to 'viz' IN-MEMORY ONLY** when a deep link arrives at a panel whose breaker has a slot position. It calls `setView('viz')`, NOT `switchView('viz')` — the cycle-18-pinned `he.panel-view` localStorage preference is **NOT** mutated, so the user's saved preference (list vs viz) survives the deep-link visit. Exception: a breaker with `slotPosition === null` isn't on the grid, so the consumer forces list view + pulses the row instead.

4. **The consumer listens for `hashchange` events**, not just route changes. A producer that's already on the same `/panels/:id` (e.g. ComponentsScreen-style "View on this panel" link on a row where the panel is implicit) can change just the hash and the consumer still fires. This is load-bearing — without it, hash-only navigations don't re-trigger the highlight effect.

5. **The slot pulse uses the new `he-slot-pulse` keyframe** (NOT the cycle-7 `he-pulse`). The slot cell needs a different visual treatment than the list-view row — an outline ring + accent-subtle glow + slight z-index lift so the halo isn't clipped by adjacent grid cells. 1.5s self-clearing, same `data-highlight="true"` attribute trigger. Both keyframes coexist; they target different DOM shapes.

6. **Double-pole breakers' merged slot cell highlights as one.** The G18 viz already renders a double-pole as ONE button spanning two grid rows/columns via `gridRow: span 2` / `gridColumn: span 2`. The highlight CSS applies to that one button — no special handling needed.

7. **Inverse direction (slot → floor map pin highlight) is DEFERRED.** A breaker can control components on multiple floors, and PanelMapScreen is single-floor at a time. Implementing the inverse needs a multi-floor design pass — out of scope for cycle-22. Tracked in VISION.md G23 as a follow-up consideration.

## E2E (Playwright — G21 cycle-21)

The cycle-21 G21 work introduces a Playwright-driven smoke + screenshot
harness. Pin these decisions — future cycles touching e2e MUST respect
them.

1. **E2E tests live at `packages/frontend/e2e/`.** Do not relocate to a
   repo-root `e2e/` or to `tests/`. The frontend-package location keeps
   the test stack co-located with the app under test and matches how
   vite-plugin-pwa already lives inside the frontend package.

2. **Chromium-only, two projects.** `playwright.config.ts` pins exactly
   two projects: `mobile-390x844` (iPhone-13-class touch viewport) and
   `desktop-1440x900` (Desktop Chrome). Firefox + WebKit are explicitly
   out of scope — the app is a mobile-first PWA served behind the
   operator's external proxy; chromium covers Android Chrome + Edge +
   iOS-via-WebKit-shape behaviorally. Adding a browser is an ADR.

3. **Tests run against an ISOLATED backend on port 3100, scoped to a
   throw-away Postgres schema.** `e2e/globalSetup.ts` spawns `@he/backend`
   via `pnpm exec tsx src/index.ts` with `DATABASE_URL` pointed at the dev
   Postgres (default `postgresql://postgres:postgres@localhost:5433/
   house_electricals`, override for CI), `DB_SCHEMA=e2e`, `DB_RESET=1` (so
   the `e2e` schema is dropped + recreated on every run), and
   `FLOOR_PLAN_DIR=<mkdtempSync>/floor-plans`. **NEVER point `DB_SCHEMA` at
   `public`** (the operator's data) and **NEVER point `FLOOR_PLAN_DIR` at
   `./data/`** (the user's working images). `globalTeardown.ts` uses
   `taskkill /T /F` on Windows or `process.kill(-pid)` (detached group) on
   POSIX, then rm-rf the tmpdir. Requires the dev Postgres to be running
   (`docker compose -f docker-compose.dev.yml up -d`).

4. **Seed via REST in globalSetup, NOT direct DB writes.**
   `e2e/seed.ts:seedFixtures(baseUrl)` POSTs deterministic data (1
   panel + 6 breakers + 1 floor + 2 rooms + 4 walls + 8 components incl.
   a 2-gang switch with switch_controls) through the public API — the
   same surface a real client uses. If a future seed needs richer data,
   add fixture variations as new functions in `seed.ts`; do not bypass
   the API.

5. **DOM contract for drag-to-link tests (additive to G20 contract).**
   The cycle-20 `data-link-target={type}` + `data-pin-id={id}` on pins
   stay the contract for the elementFromPoint hit-test. Cycle-21 adds
   the TEST-side hooks: `data-testid="link-layer"` on the decorative
   `<svg>`, `data-testid="control-line"` on each rendered control line,
   `data-testid="link-drag-line"` + `data-valid-target="true|false"` on
   the in-flight drag line, `data-testid="gang-handles"` +
   `data-switch-id` on the handle container, `data-testid="gang-handle"`
   + `data-gang-index` on each gang button. Test hooks are READ-ONLY —
   no behavior depends on them; removing one would break a test, not
   the app.

6. **Modal primitives carry stable test hooks.** `Modal` accepts a
   `testId` prop (defaults to `'modal'`); ConfirmModal/PromptModal/
   PickerModal pass `confirm-modal`/`prompt-modal`/`picker-modal`. The
   primary action buttons are named via `data-testid` (e.g.
   `prompt-modal-confirm`, `prompt-modal-cancel`,
   `picker-modal-option` with `data-value` when the value is a string
   or number). `aria-labelledby` (via `useId()`) replaces the cycle-20
   `aria-label` so screen readers announce the dialog title verbatim.

7. **`pnpm test:e2e` (run from `packages/frontend/`) is canonical.** It
   boots Vite on port 5180 with `BACKEND_DEV_URL=http://127.0.0.1:3100`
   pointing at the isolated backend; from a clean checkout you need
   `pnpm install` + `pnpm --filter @he/frontend exec playwright install
   chromium` once before the first run. `pnpm test:e2e:headed` for
   debugging; `pnpm test:e2e:report` opens the HTML report.

8. **Polish stories may change token VALUES + add net-new tokens. They
   MUST NOT rename existing token names.** This is the cycle-11/17/20
   rule, re-pinned because cycle-21 introduced a fix-pass workflow that
   makes it tempting. `--shadow-tabs` is a net-new token added in
   cycle-21 (US-005) and is allowed. Renaming any of the cycle-11+ token
   names (e.g. `--color-bg-canvas`, `--space-N`, `--radius-md`) requires
   an ADR.

9. **Smoke spec uses deterministic waits ONLY.** No `page.waitForTimeout`.
   Use `expect(locator).toBeVisible()` / `toHaveText()` / `waitForLoadState`
   — Playwright's auto-waiting locators handle the rest. Flaky tests get
   fixed, not retried.

10. **Screenshots are gitignored.** `e2e/.screenshots/`,
    `playwright-report/`, `test-results/`, and `e2e/.state.json` all
    live under `.gitignore`. The repo ships the harness, not the
    artifacts. Triage screenshots get summarized in the cycle's
    `scripts/ralph/progress.txt`; the next cycle re-runs to regenerate
    the visual baseline.

## Modal primitives + drag-to-link (G20 — cycle-20)

The cycle-20 G20 polish work introduces custom Modal primitives and on-canvas drag-to-link UX. Pin these decisions — future cycles touching these surfaces MUST respect them.

1. **`window.prompt` / `window.confirm` are banned.** Every interactive dialog uses the imperative `useModal()` hook from `packages/frontend/src/hooks/useModal.tsx`:
   - `await confirm({ title, message, confirmLabel?, confirmVariant? })` → `Promise<boolean>` (false on cancel)
   - `await prompt({ title, label, defaultValue?, placeholder? })` → `Promise<string | null>` (null on cancel; otherwise returns a trimmed, non-empty string — empty submit is disabled at the UI layer)
   - `await pick<T>({ title, options: PickerOption<T>[], emptyMessage? })` → `Promise<T | null>` (null on cancel)
   - The consumer renders `{modalNode}` at its screen root.
   The underlying components are `Modal` (base), `ConfirmModal`, `PromptModal`, `PickerModal` in `packages/frontend/src/ui/`. **Do not** call `window.prompt` / `window.confirm` in a future cycle — typecheck would let it slip, so this rule is enforced by code review + commit message convention.

2. **One modal per `useModal()` instance.** Concurrent calls follow a **replace-policy**: the prior promise resolves with cancel-equivalent (`false` / `null`) before the new modal opens. No queuing. Each screen calls `useModal()` once and threads `modalNode` through its render — do not call it inside loops or per-row.

3. **PromptModal trims + rejects empty.** The Save button disables when `value.trim().length === 0`. ENTER inside the input submits via a hidden submit button. The resolver hands back the trimmed string; consumers do NOT need to re-trim. Empty-rename short-circuits are gone from screen code — the modal enforces it.

4. **Gang→light/outlet drag-to-link UX is screen-owned in `FloorEditScreen`**, not a shared hook (yet). The state shape is `{ switchId, gangIndex, origin: viewbox-Point, current: viewbox-Point, hoverPinId }`. While `linkDrag !== null`:
   - A window-scoped `pointermove` listener updates `current` (via `viewport.screenToViewbox`) and re-runs the hit-test.
   - Pin hit-test = `document.elementFromPoint(x, y).closest('[data-link-target]')` and reads `data-pin-id`. Targets are valid only when `data-link-target === 'light' || 'outlet'`.
   - A `pointerup` listener resolves: valid target → `addSwitchControl(switchId, gangIndex, pinId)` (POST is idempotent via `INSERT OR IGNORE`); invalid / no target → **silent cancel** (no toast spam).
   - **Pin elements MUST carry `data-link-target={c.type}` + `data-pin-id={c.id}`.** This is the hit-test contract — any new pin renderer must propagate both attrs.

5. **The SVG link-layer is decorative.** `.floor-plan__link-layer` lives inside `.floor-plan`, transformed by `viewport.transformAttr`, with `pointer-events: none`. It renders TWO things:
   - **Control lines (US-005):** when a switch is selected, one `<line>` per `switchControls` entry from the switch's pin to each controlled pin. Class `.floor-plan__control-line` (thin, dashed, accent, low-opacity).
   - **In-flight drag line (US-004):** while `linkDrag !== null`, one `<line>` from `origin` to `current`. Class `.floor-plan__link-drag` (animated marching dashes, foreground); gains `--valid` modifier when `hoverPinId !== null` (turns success-tinted and slightly thicker).
   Stroke widths are in **viewbox units** + `vector-effect: non-scaling-stroke` so the line stays visually thin regardless of zoom.

6. **Gang handles are HTML buttons positioned at the switch pin's CSS-% coords**, with a fixed `padding-top: 56px` pushing them below the pin in screen pixels (NOT viewbox units — independent of zoom). The container has `pointer-events: none`; only the inner badge buttons re-enable pointer events. **Do not put gang handles inside the SVG link-layer** — making them SVG circles broke focus + accessibility in an earlier draft.

7. **Token value tweaks (G20):** `--color-bg-surface-raised` lifted `#1f2632` → `#222936`; `--color-bg-hover` `#232b39` → `#2a3344`; `--color-bg-overlay` `rgba(6,9,13,0.78)` → `rgba(3,6,11,0.78)`; `--color-border-strong` `#404858` → `#4a5363`. Token NAMES unchanged — only values. The modal overlay uses `backdrop-filter: blur(6px) saturate(120%)` and modals animate in via `he-modal-rise` (translateY 8px + scale 0.985).

## Quick-create + multi-gang switches (G19 — cycle-19)

`/floors/:id/edit` gains quick-create tools (Outlet/Light/Switch) and multi-gang switch wiring. Pin these decisions — future cycles touching this surface MUST respect them.

1. **`components.gangs` defaults to 1; only switches may have gangs > 1.** The DB CHECK only bounds the range (1..8). PATCH does NOT reject `gangs > 1` for non-switch types — the UI is the only enforcer. Non-switch types simply ignore the field.

2. **`switch_controls` is many-to-many** between a switch's gang and a controlled light/outlet. Composite PK `(switch_id, gang_index, controlled_id)` prevents duplicate links. `INSERT OR IGNORE` on the route makes re-linking the same pair an idempotent no-op.

3. **`gang_index` is 0-based in storage; UI presents as "Gang 1" … "Gang N" (display = index+1).** Don't shift one or the other in a future cycle.

4. **Only `type='light'` OR `type='outlet'` may be the controlled side.** Validated at POST. Future controlled types (appliance, junction_box) are explicitly out of scope unless added via ADR.

5. **Quick-create auto-name format:** `Outlet N`, `Light N`, `Switch N` (1-gang), or `N-gang switch M` (multi-gang). N is `count-of-this-type-on-floor + 1`. After successful create, the tool snaps back to `pointer` so the next tap selects rather than creates.

6. **Component pin click is only active in `pointer` tool mode.** In a quick-create tool mode, the capture SVG layer takes pointer events (so clicking on top of an existing pin still creates a NEW component at that position — by design, since the user explicitly picked the tool).

7. **components.gangs ALTER must run AFTER the floor_id rebuild migration.** The `ensureComponentsFloorIdColumn` rebuild template uses a CREATE TABLE that doesn't include gangs; if gangs is added before the rebuild, it gets dropped. Order in `openDatabase` is load-bearing — don't reorder without re-checking this.

## Panel visualization (G18 — cycle-18)

`PanelDetailScreen` renders a visual diagram of each panel via `ui/PanelVisualization`. Pin these decisions — future cycles touching this surface must respect them.

1. **Slot numbering starts at 1** and maps to `breaker.slotPosition` where present. Breakers with `slotPosition === null` are NOT rendered in the grid — they only show in the "List" view toggle.

2. **Orientation rule**:
   - `vertical` (default) = 2-column grid; slots 1,2 on top row, 3,4 on next, etc. Matches a real residential tall-narrow panel.
   - `horizontal` = ceil(slotCount/2) columns × 2 rows; odd slot numbers on top row, even on bottom.

3. **Double-pole breakers span TWO slot positions visually.** A breaker with `poles === 'double'` at slot N renders as a single tall (vertical) or wide (horizontal) cell occupying slots N and N+1; the rendering hides slot N+1 entirely. The data model does NOT enforce this — it's purely a render-time visual convention.

4. **Tandem breakers stay 1 slot** but get a 45° stripe background via `repeating-linear-gradient` so the user can tell a tandem from a single at a glance.

5. **View-toggle preference lives in `localStorage` key `he.panel-view`** (values: `'viz'` | `'list'`). Per-device, not per-user (since the app has no auth).

6. **`panels.orientation` + `panels.slot_count` are additive columns with DB DEFAULTs** (`'vertical'` + `24`). Existing rows pre-G18 inherit the defaults without an explicit data migration. Future cycles MUST NOT change the defaults without an ADR — pre-G18 panels will quietly reinterpret if you do.

7. **Slot-click contract:** empty slot → pre-fill the add-breaker form (slot=N, slotPosition=N) + focus the label input. Existing-breaker slot → set editingId + scroll the row into view. The form / list / edit affordances stay primary; the visualization is a navigation aid, not a separate edit surface.

## Desktop map builder (G15 — cycle-16)

`/floors/:floorId/edit` is the desktop-class floor editor. Pin these decisions — cycle 17 (visual refresh) and any future canvas work must respect them.

1. **Viewport state is client-only, per-mount.** `useViewport` owns `{ scale, tx, ty }` in screen state. NEVER persist to DB or URL — only the `floorId` lives in the URL. A future "remember last zoom" feature would store in localStorage, NOT the floor row.

2. **Screen-to-viewbox conversion ALWAYS goes through `useViewport.screenToViewbox`** when the canvas might be zoomed/panned. The base `defaultNormalize` (cycle-13/14 pattern) is only safe when no transform is applied — that's why `useWallEditor` and `useRoomEditor` accept an optional `screenToViewbox` prop. `PanelMapScreen` doesn't supply it (no viewport there); `FloorEditScreen` does.

3. **Keyboard shortcuts are pinned**: `V` = pointer · `W` = wall · `R` = room · `ESC` = deselect/cancel · `Delete`/`Backspace` = remove selected · `0` = reset viewport. The handler is gated on the focused element not being INPUT/TEXTAREA. Don't change shortcuts without an ADR.

4. **Tool-mode state is owned by `FloorEditScreen`**; `useWallEditor` + `useRoomEditor` are dumb consumers driven by `active = (tool === 'wall')` etc. Selection state (`selectedWallId`, `selectedRoomId`) is also screen-owned. Editors only own in-flight gesture state (firstEndpoint, ghostEndpoint, drawing, cornerDrag, endpointDrag).

5. **Image-underlay is NOT transformed by the viewport in cycle 16.** Pan/zoom moves the SVG geometry only; the underlay image stays static. This is a known limitation — CSS-pixel transforms vs viewbox-unit transforms mismatch makes a clean implementation require container-rect tracking. Revisit in a future cycle if the underlay-static behavior bothers users.

6. **Layout pivot at 960px**: above 960px viewport width, the editor renders 3-column (tools 240px | canvas 1fr | properties 320px); below, single column with tools collapsing to a horizontal palette. **Do not adjust the breakpoint without testing the canvas readability at common laptop widths (1280-1440).**

7. **Same hooks, two consumers.** `useWallEditor` and `useRoomEditor` are shared with `PanelMapScreen`. If a future change is needed to one of them, it MUST keep PanelMapScreen working — both consumers test the regression.

## Room editor (G12 rooms)

The cycle-14 G12 rooms work introduces axis-aligned rectangle "rooms" with center text labels. Pin these three decisions — future cycles (polygons, label-editing UX, etc.) must respect them.

1. **Rooms are now POLYGONS** (`points` JSONB), with `(x, y, w, h)` kept as the derived bounding box. ~~Polygons are deferred.~~ **SUPERSEDED 2026-05** — see "Polygon rooms + wall-graph (2026-05)" below. The migration predicted here (add a `points` column, backfill 4-point arrays from each rectangle) is exactly what shipped, except `x/y/w/h` are KEPT (as the bbox for label centering + the rectangle X/Y/W/H editor) rather than dropped.
2. **Schema invariants**: `name TEXT NOT NULL` (zod rejects empty), `floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE` (rooms die with their floor, same as walls). `w` and `h` must be ≥ 1 (zero-area rectangles rejected at both the DB CHECK and zod layers). **PATCH never accepts `floor_id`** — rooms don't migrate between floors.
3. **Room label rendering = SVG `<text>` centered inside the existing `FloorPlanVectorOverlay` viewBox.** No HTML overlay layer. Font-size is in viewbox units (320 ≈ 3% of canvas) and scales naturally with zoom. Don't introduce per-zoom pixel-sizing logic.

Additional notes:
- Rooms render **BEHIND walls** in the overlay z-order so wall strokes stay crisp on top of room fills.
- The cycle-14 room-name UX uses `window.prompt` for first-time naming. A sheet/popover replacement is acceptable future polish but NOT load-bearing — VISION's "sketching tool" framing accepts utilitarian inputs.
- Room edit mode is a **3-way mutually-exclusive `tool` state** on `PanelMapScreen`: `'pin' | 'walls' | 'rooms'`. Switching modes disables the other two layers' pointer events. Don't introduce a separate route for the editor.
- Corner-drag uses the same PATCH-only-on-pointerup rule as wall endpoint drags + pin drops. PATCH-on-pointermove would flood the backend at 60Hz.

## Unbounded coordinate space (2026-05)

The floor-plan coordinate space was widened so the plan feels effectively
infinite (user feedback: "the plan should span infinite x and y, I look
constraint from x = 0 and x = 8250. I can't move anything past those
boundaries"). Pin these decisions — they RECONCILE the many historical
"0-10000 normalized" references scattered through the ADRs below.

1. **The `10000` NORMALIZATION SCALE is unchanged.** Coordinates are still
   per-ten-thousand integers; the SVG renders through a FIXED
   `viewBox="0 0 10000 10000"` *window*; `vbToPctX` still divides by 100;
   image-backed floors still normalize pins relative to the image's natural
   size as `pos / 10000`. Historical "0-10000 normalized coord space" notes
   describe THIS scale + window — NOT a hard clamp.

2. **What changed is the CLAMP.** Geometry may now live anywhere in
   `COORD_MIN..COORD_MAX` (= ±100000; room w/h up to `ROOM_DIM_MAX` = 200000),
   exported from `@he/shared`. The viewport (pan + zoom) slides the 0-10000
   window across this larger logical canvas, so far-out / negative geometry
   is reached by panning. `useViewport` `MIN_SCALE` was lowered to `0.05` so
   fit-to-content can frame a sprawling plan.

3. **Three sync points — keep them aligned, do NOT re-narrow to 0-10000:**
   (a) `@he/shared` `COORD_MIN`/`COORD_MAX`/`ROOM_DIM_MAX` + the `coord` /
   `roomCoord` / `roomDim` / `posX` / `posY` zod schemas; (b) the walls/rooms
   `*_bounds` CHECK constraints in `backend/src/repository.ts` (CREATE TABLE +
   the idempotent `DO $$` widening migration that converts the legacy
   auto-named `*_check` constraints); (c) `frontend/src/lib/snap.ts`'s clamp.

4. **FloorEditScreen is the only "infinite" surface.** It has the viewport
   (pan/zoom) so off-window geometry is reachable. `PanelMapScreen` has NO
   viewport — its pointer input is naturally bounded by the visible canvas
   rect, so it's unaffected and was intentionally left alone.

5. **Component pins are drag-to-move in FloorEditScreen (pointer mode).**
   A pin pointerdown starts a pointer-captured drag (window pointermove via
   `viewport.screenToViewbox` + `snapPoint`); a movement threshold
   (`PIN_DRAG_THRESHOLD_PX`) separates a reposition from a tap-select. PATCH
   only fires on release (never on pointermove — the `useMapDrag` rule). The
   live position flows through `displayedComponentsOnFloor` so the pin + its
   gang handles + control lines track in lockstep. Room auto-binds only when
   the component's room is null (the G26 cycle-32 "never overwrite a manual
   room" rule). The sidebar X/Y/W/H + corner handles already read
   `displayedRooms`, so they live-update during a resize too.

## Polygon rooms + wall-graph (2026-05)

Implements the deferred G12 polygon-room path + a shared-vertex wall model
(user feedback: "Converging walls together should link them together. Closing
walls to a fully [enclosed] room should ask for room name and create a room
using those walls as delimiters. Each wall end becomes a point that can be
drag to resize and reshape the room"). Pin these decisions.

1. **A "vertex" is a coordinate — there is NO vertex table.** Wall endpoints
   that share an exact coordinate are the same graph vertex; that's how
   "converging walls link." Snapping makes them coincide: `useWallEditor`
   takes `getSnapVertices()` and snaps a drawn/dragged endpoint onto any
   existing wall endpoint or room vertex within `VERTEX_SNAP_DIST` (350 vb
   units) via `lib/snap.snapWithVertices`. Do NOT add a `vertices` table —
   coincident-coordinate identity is the model.

2. **Rooms are polygons** (`points: {x,y}[]` JSONB, >= 3) with `x/y/w/h` kept
   as the derived bounding box (label centering + the rectangle X/Y/W/H
   editor). `@he/shared` owns the shape helpers: `rectToPolygon`,
   `polygonBounds`, `isAxisAlignedRect`. The backend `normalizeRoomShape`
   accepts EITHER a rectangle (`x/y/w/h`) OR a polygon (`points`) and stores
   both; `roomInputSchema` refines that one complete shape is present.
   Migration: `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS points JSONB` +
   backfill each rectangle as its 4 corners.

3. **Closed-loop detection → room.** `lib/wallGraph.findLoopThrough(walls,
   wallId)` BFS-finds the MINIMAL cycle through a just-drawn/dragged wall
   (BFS = tightest enclosing face, not a rambling one). On a new loop that
   doesn't already match a room (`loopMatchesAnyRoom`), FloorEditScreen
   prompts for a name and `createRoom(floorId, { name, points })`. Wired into
   BOTH the wall `onCommit` (draw) and `onEndpointCommit` (drag-to-close).

4. **Editing model splits on `isAxisAlignedRect(points)`:** rectangle rooms
   keep the existing corner-resize (resize-keeps-rectangle) + translate +
   X/Y/W/H sidebar; polygon rooms get per-vertex drag handles
   (`data-testid="room-vertex-handle"`) + a read-only sidebar hint. A
   rectangle is NOT free-deformed by its corners (that stays a resize) — to
   get a polygon room you draw walls and close a loop. This honors the user's
   "keep both" choice (rectangle tool unchanged).

5. **Vertex drag moves walls + room together.** Dragging a room vertex moves
   the room's point AND every coincident wall endpoint AND every other room's
   coincident vertex (they share a coordinate). Live preview via
   `displayedRooms` (vertexDrag branch) + a new `displayedWalls` memo; commit
   on pointerup PATCHes the affected room(s) `points` + wall(s) endpoints in
   one `Promise.all`, with full rollback on failure. PATCH-only-on-pointerup
   (the load-bearing 60Hz rule).

6. **`findRoomForPoint` is now point-in-polygon** (ray-cast, boundary-
   inclusive — preserves the G26 "on the wall counts as in the room" intent),
   so component room auto-bind works for L-shaped rooms. Rectangles are
   4-point polygons, so this subsumes the old rect test.

7. **`PanelMapScreen` is unaffected** beyond rendering rooms as `<polygon>`
   (rectangles ARE 4-point polygons, identical pixels). It has no wall-loop
   flow / vertex handles — that's FloorEditScreen-only (the viewport surface).

8. **Walls absorbed into a room outline are hidden + non-selectable.**
   `lib/wallGraph.roomBoundaryWallIds(walls, rooms)` returns the IDs of walls
   whose segment IS a room polygon edge (direction-independent). FloorEditScreen
   filters those out of the wall render (overlay `visibleWalls`), the wall
   hit-layers, and the endpoint handles — so once a loop becomes a room the
   canvas reads as a clean room (the room's thin outline), NOT a room ringed by
   the thick `--color-fg-default` `.floor-plan__wall` strokes, and you can't
   select the constituent walls (clicking the edge selects the room). This is
   DERIVED from current geometry + the walls are NOT deleted: deleting or
   reshaping the room re-evaluates the set, and vertex-drag keeps the hidden
   walls coincident with the room edges so they stay absorbed. Creating a room
   deselects the closing wall and selects the new room.

Pure logic is unit-tested: `lib/wallGraph.test.ts` (loop detection, minimal
face, degenerate rejection) + `lib/roomLookup.test.ts` (point-in-polygon).
Backend: `rooms.test.ts` covers polygon create / bbox derivation / points
PATCH / name-only no-op / < 3-point rejection.

## Wall editor (G12 walls)

The cycle-13 G12 work introduces an in-app vector wall editor. Pin these four decisions — future cycles (rooms in cycle-14, G14 placement on drawn plans, etc.) must respect them.

1. **`walls.floor_id` is NOT NULL with `ON DELETE CASCADE`.** Walls can't exist detached from a floor — they ARE geometry on a specific floor. This is the opposite of `components.floor_id` which is nullable + `SET NULL` because components model real-world objects that exist before placement. Do NOT relax `walls.floor_id` to nullable.
2. **Snap step is fixed at 1/40 of the 10000-unit normalized canvas (= 250 units).** Not user-configurable. `SNAP_STEP` is a constant in `packages/frontend/src/lib/snap.ts`. **Future configurability adds a `grid_step` column to `floors`** (per-floor) — NOT a global setting. Do not add a global preferences screen.
3. **Vector-first floors render at 1:1 canvas aspect** when no image is uploaded (`.floor-plan--vector-only`). When an image is later attached, walls' normalized 0-10000 coords stay numerically identical and visually reproject to the image's natural aspect ratio. **Do not gate wall-drawing on image presence** — VISION explicitly preserves the vector-only path.
4. **SVG `preserveAspectRatio="none"` is intentional.** The walls overlay tracks the underlay's exact display box. This means walls visually distort if the underlay's aspect changes between uploads — the same trade-off pins accept. Don't "fix" this by switching to `xMidYMid meet`.

Additional notes:
- **Coord space is 0-10000 integers** (same as `components.posX/posY`). The schema enforces this with SQLite `CHECK (x1 BETWEEN 0 AND 10000)` per coord plus the shared zod schema. The `snap()` helper clamps to this range.
- **PATCH never accepts `floor_id`.** A wall cannot move between floors via the PATCH endpoint — the FK is a creation-time decision. Cross-floor "move wall" is a delete + create, never a PATCH. This kills a class of footguns.
- **Editor is entered via an explicit "Edit walls" toggle on `PanelMapScreen`**, not a separate route. When ON, pin UX is fully disabled (the pin buttons aren't even rendered). When OFF, pin UX behaves exactly as cycle-12.
- **Wall draw is a two-tap state machine** (not press-drag) — `useWallEditor` state: `idle → first-endpoint-set → on-second-tap commits + back to idle`. ESC cancels the pending first endpoint. Both endpoints pass through `snap()` before commit. Tap on an existing wall (in edit mode) selects it instead of drawing.
- **Endpoint move = press-drag with PATCH only on pointerup.** Same rule as `useMapDrag` for pins (load-bearing — drag-during-move would flood the backend at 60Hz). The handle circle follows the snapped current point during drag for visual feedback.
- **Wall delete is explicit confirm + DELETE.** Tap to select → "Delete wall" button → `window.confirm` → DELETE. No swipe-to-delete or right-click — this is mobile-first PWA.
- **Pinch-zoom is deferred** to a future G12 cycle. The 1/40 snap step on a phone-sized canvas means grid cells render at ~9px, but the snap is forgiving (release-point snap, not tap-precision) — workable today, much better once pinch-zoom lands.

## Multi-floor model (G13)

The cycle-12 G13 work makes floors house-level entities. Three sticky decisions pinned here so future cycles don't relitigate:

1. **Floors are home-scoped — NO parent FK in single-house mode.** The `floors` table has no `house_id` column today. A future multi-house migration will add a nullable `house_id`, backfill, then promote to NOT NULL — same playbook as G3's `components.breaker_id`. **Do NOT retrofit a parent FK speculatively** ("just in case we ever want multi-house") — it's free until needed.
2. **`/panels/:id/map` stays panel-scoped post-G13.** The floor switcher updates the URL via `?floor=<id>` query param. Map filtering, upload/replace/remove all operate on the selected floor. **A whole-house map view, if ever needed, is a SEPARATE route** (e.g. `/floors/:id/map`), not a rename of `/panels/:id/map`. The route preserves the deep-link contract (`#breaker-<id>` from components still works) and the SWR runtime-cache allow-list.
3. **G13 migration is ONE-WAY.** `backfillFloorsFromPanels()` in `repository.ts` is idempotent (gated on floors-empty AND legacy columns present) but has no down path. Operators back up `${DATA_PATH}/db.sqlite` before deploy. **This policy generalizes to all schema-dropping migrations going forward.**

Additional notes:
- **`components.floor_id`** mirrors `breaker_id`: nullable TEXT, `ON DELETE SET NULL`. `SqliteFloorRepository.delete()` runs the belt-and-suspenders `UPDATE components SET floor_id = NULL WHERE floor_id = ?` inside its own transaction, gated by a `PRAGMA table_info` check so the repo is usable before the column exists.
- **Backfilled floor names = panel name**, NOT "Main floor". A user with 3 panels gets 3 distinct floor names (e.g. "Basement panel", "Main panel", "Garage panel") so the post-migration UI doesn't show three identical labels. The user can rename freely afterward.
- **Legacy `panels.floor_plan_filename` / `image_width` / `image_height` columns are kept (not dropped)** post-migration as a soft rollback path. New code never reads them. A future cleanup cycle may physically drop them once we're confident no rollback is needed.
- **Floor-plan upload routes are floor-scoped post-G13**: `POST /api/v1/floors/:floorId/floor-plan`, `DELETE` same. Per-panel routes removed. Filename convention unchanged (`<floorId>-<sha8>.<ext>` still self-cache-busts).
- **The "View on map" deep link** uses URL hash format `#pin-<componentId>` on `/panels/:panelId/map?floor=<floorId>`. The `id="pin-<id>"` lives on the pin `<button>` element. PanelMapScreen consumes this hash on mount, scrolls/centers, sets selectedComponentId, and pulses the pin via `data-highlight="true"` + the existing `he-pulse` keyframe. Future producers of this link MUST use the exact `#pin-<id>` format.
- **TestPanelScreen off-state invariance (G14).** The "currently off" Set lives in screen state as a single global `Set<string>` per-mount. The floor switcher (added in cycle-14) **narrows the displayed component list only** — it does NOT mutate the off-set. A breaker is a physical device; its on/off state is the same regardless of which floor tab the user is viewing. Do NOT change this to per-floor off-state in a future cycle without an explicit ADR and updated UX copy — the current model assumes physical-breaker reality.

### Floor URL contract (G16 — cycle-15)

There are **two complementary URLs for viewing a floor**. They are NOT redundant; they answer different questions.

- **`/panels/:panelId/map?floor=<id>`** — the **electrical view**. Shows pins for THIS PANEL'S breakers on the selected floor, plus the walls/rooms vector overlay as background context. Canonical answer to "where are my components placed?" Pinned in cycle-12 Lockin. Deep-links from `/components` "View on map" point here.
- **`/floors/:floorId/edit`** — the **management view**. Shows the floor itself: its name + dimensions, all its walls + rooms (read-only in cycle-15; editable in cycle-16's G15), the list of panels with components on this floor (each row links into the per-panel electrical view above), and rename + delete actions. Canonical answer to "manage / build this floor." MapLandingScreen rows link here; `handleCreateFloor` navigates here on success.

**Do not collapse the two URLs into one in a future cycle without an ADR.** They serve different mental models — collapsing forces every consumer to reason about both purposes at once.

**`PanelMapScreen` switcher inclusion rule (cycle-15):** the floor-switcher surfaces (a) floors with ≥1 component on this panel's breakers AND (b) the floor explicitly referenced by `?floor=<id>`. Deep links to empty referenced floors no longer silently fall through to a different floor — they show that floor in the switcher and select it. **Do not narrow back to qualifying-only without preserving the deep-link guarantee.**

**Floor delete canonicality (cycle-15):** the canonical surface for deleting a floor is the "Danger zone" Button on `/floors/:id/edit`. Convenience deletes elsewhere (e.g. row-level on MapLandingScreen if ever added) MUST use the same `deleteFloor()` api call AND the same confirm copy template (which includes the affected component count). **Do not diverge confirm flows.**

**Routing-level escape hatch (cycle-15 first user):** new full-bleed-capable routes use the routing-level escape — declared OUTSIDE the AppShell-wrapped `<Switch>` in `App.tsx` — NOT a `fullBleed` prop on AppShell. The legacy `PanelMapScreen` `fullBleed` is **grandfathered**; do not propagate. Cycle-15's `/floors/:id/edit` is the first user of the route-outside-Switch pattern; cycle-16's G15 desktop canvas must follow the same.

## URL convention (REST)

- **Collection routes nest under their parent when the resource is inherently parent-scoped** (e.g. breakers under panels): `GET /api/v1/panels/:panelId/breakers`, `POST /api/v1/panels/:panelId/breakers`.
- **Collections that span parents or have no inherent parent are flat** (e.g. components, which exist house-level and only optionally point to a breaker): `GET /api/v1/components?room=&type=`.
- **Item routes are always flat**: `GET /api/v1/breakers/:id`, `GET /api/v1/components/:id`, `PATCH /api/v1/breakers/:id`, etc.
- Future child resources follow the same rule. Don't re-debate per resource.
- All routes live under `/api/v1/` and respond with the `{ data: T }` envelope on success or `{ error: { message: string } }` on failure.

## Cascade behavior (data-integrity rules)

- **`components.breaker_id` has `ON DELETE SET NULL`** at the FK level. Belt-and-suspenders: `PgBreakerRepository.delete()` *also* runs `UPDATE components SET breaker_id = NULL WHERE breaker_id = $1` inside the same transaction before the `DELETE FROM breakers`. This is intentional duplication — the FK is the database-level invariant, the app-level update is greppable and survives a future migration that forgets the FK clause.
- **Panel delete** in `PgPanelRepository.delete()` iterates the panel's breakers and runs the breaker-delete logic (`UPDATE components SET breaker_id=NULL` + `DELETE FROM breakers`) inline for each, then deletes the panel — all inside one `db.transaction(...)` callback. **Do not call `breakerRepo.delete()` recursively** from `panelRepo.delete()`: the cascade runs on the single transactional client handed to the callback, so the breaker-delete logic is flattened inline rather than re-entering another repository's own transaction.
- The end-to-end invariant: deleting a breaker OR a panel never deletes components. Components survive as Unassigned (`breaker_id IS NULL`).

## List filters (search vs exact-match)

- **`/api/v1/components?room=<value>`** is exact-match, case-sensitive (Postgres default collation — `=` comparison, no `LOWER()`). Used when the caller knows the exact room name.
- **`/api/v1/components?search=<term>`** is case-insensitive substring matching `name` OR `room` OR `service_entries.note` (via `LOWER(...) LIKE LOWER('%term%')`). Used for typeahead / fuzzy filtering from a search box.
- **As of cycle-67 (G40 Part 2), search ALSO matches `service_entries.note` content** for the `?search=` query on `/api/v1/components`. The widened clause uses an `EXISTS` subquery against `service_entries` filtered by `parent_type='component' AND parent_id=c.id`. Result rows are still per-component (deduplicated via `EXISTS` — a component appears once even if multiple log entries match). The note LIKE is intentionally NOT extended to `breakers.label` or `breaker_tests.outcome` — those have their own surfaces (`/audit`, panel details). Performance: the EXISTS uses the cycle-66 `idx_service_entries_parent(parent_type, parent_id, occurred_at DESC)` composite for the parent_id lookup; the note LIKE is a table-scan within matching entries, acceptable given the small per-component entry count in practice.
- All filters AND-combine: `?room=Kitchen&type=outlet&search=plug` returns outlets in (exact) "Kitchen" whose name OR room OR ANY service-entry note contains "plug" case-insensitively.
- **Search filters, never reorders.** The canonical sort `created_at ASC, id ASC` is always preserved, regardless of which filters are active. Don't add relevance ranking in a future cycle without an ADR.

## Deep links (URL hash contracts)

- **`/panels/:panelId#breaker-<breakerId>`** scrolls to and pulse-highlights the matching breaker on PanelDetailScreen. The `id="breaker-<id>"` attribute is on the always-rendered `BreakerRow` `<li>` — **never the lazy-expand body**, because the body may not be in the DOM at navigation time.
- The component-row callout on `/components` is the canonical producer of these links. Any future producer (notifications, share buttons) must use the same hash format.
- The highlight is purely visual (`data-highlight="true"` attribute + CSS keyframe); it self-clears after 1.5s.

## Reverse views (avoid splitting the API surface)

- For a child collection scoped by a nullable FK, use a **query-filter on the existing flat collection route**, not a nested route.
  - DO: `GET /api/v1/components?breakerId=<id>` to list components on a breaker.
  - DON'T: add `GET /api/v1/breakers/:id/components` — that would split the surface and force every client to learn two URLs for the same data shape.
- For a child collection inherently parent-scoped (no nullable FK, the child cannot exist without the parent), use a nested route. Cycle 4's `GET /api/v1/panels/:panelId/breakers` is the canonical case.

## Future-cycle commitments (don't break these)

- **`components.breaker_id` stays nullable through G3 and beyond.** It was added in cycle 5 with a nullable FK and stays that way: the app's UX model is "components can be unassigned." Never add a NOT NULL constraint or auto-assign migration.
- **Component types are frozen** at the 7 values in the `components.type` CHECK constraint: `outlet`, `light`, `switch`, `appliance`, `junction_box`, `smoke_detector`, `other`. Adding new values requires `ALTER TABLE components DROP CONSTRAINT … ; ADD CONSTRAINT … CHECK(...)` (Postgres can drop + re-add a CHECK without a full table rebuild). If a new type is needed, write a migration with explicit ADR and bump the constraint atomically.
- **`?room=` and other text filters are exact-match, case-sensitive** (Postgres default collation). If a future cycle wants typeahead or fuzzy match, build it client-side from the row set or add a separate fuzzy endpoint — don't change the existing contract.

## Request validation

- Backend validates request bodies with `zod` via `@hono/zod-validator` (`zValidator('json', schema, …)`).
- **Schemas live in `@he/shared`** so backend and frontend share one source of truth. Re-export `z` from `@he/shared` so consumers never pull in their own zod version.
- The frontend uses the same schemas via `@hookform/resolvers/zod` + `react-hook-form`.

## Persistence

- All DB writes go through a `Repository` interface defined in `@he/shared` (`PanelRepository`, `BreakerRepository`, …). The Postgres implementation is in `packages/backend/src/repository.ts` (the `Pg*Repository` classes); the `pg` access layer is `packages/backend/src/db.ts`. See "Persistence is PostgreSQL" at the top of this file for the full contract.
- A single `Db` (pool-backed, from `createPool`) is shared across repos. Cross-table operations like the panel→breakers cascade run inside `db.transaction(fn)`, which hands `fn` a single transactional `Querier` so every statement lands on the same connection.
- **Cascade deletes are application-level, not FK `ON DELETE CASCADE`.** This is intentional: future cycles (G7 breaker-test history) may want retention; an early FK CASCADE silently destroys child rows. Wrap multi-table deletes in `db.transaction(...)` (see `PgPanelRepository.delete`).
- IDs are ULIDs via `newId()` from `@he/shared`. **Use `monotonicFactory()`** (already wired) so same-millisecond inserts sort consistently.
- Timestamps are **epoch milliseconds** (`Date.now()`), stored as `BIGINT` (Postgres `INTEGER` is 32-bit and would overflow). The `pg` BIGINT→number type parser is registered in `db.ts`. Pinned in shared types as `createdAt: number`.

## Testing

- Backend tests run via `tsx --test src/**/*.test.ts`. **Do NOT reintroduce vitest** in the backend (it mis-resolved `node:sqlite` historically; the runner choice is now just project convention — keep `tsx --test`).
- Tests live next to source as `*.test.ts`; tsconfig excludes them from emit.
- **Tests run against a REAL Postgres**, isolated per-suite by schema. `createTestDb()` (`test-helpers.ts`) makes a pool scoped to a unique `test_<ulid>` schema (via `-c search_path=…`), runs `initSchema`, and returns `{ db, schema, cleanup }`; `cleanup()` drops the schema CASCADE + closes the pool in `afterEach`. Point `DATABASE_URL` at a dev Postgres — default `postgresql://postgres:postgres@localhost:5433/house_electricals` (start it with `docker compose -f docker-compose.dev.yml up -d`).

## Frontend write paths (optimistic UI)

- All write paths that are idempotent and per-item (PATCH a single resource) should go through `packages/frontend/src/hooks/useOptimisticPatch.ts`.
- Contract: the caller updates its local state immediately; the hook tracks pending + errors keyed by item id, retries on transient failures (default 2 attempts with 250ms linear backoff), and exposes a `pending: ReadonlySet<string>` plus an `errors: ReadonlyArray<{id, message}>` for per-row indicators.
- Last-write-wins per id: retriggering a patch for the same id invalidates the prior call's error reporting. This requires the underlying PATCH to be idempotent.
- New write paths copying this pattern: import the hook, don't fork the queue logic. Don't add a parallel "save bar" component for write paths the hook already serves.

## Drag interactions on the floor plan

- `useMapDrag` in `packages/frontend/src/hooks/useMapDrag.ts` is the single drag controller used by both unplaced sidebar items and placed pins.
- **PATCH only on pointerup**, never on pointermove. The hook updates ghost position locally during the drag; the consumer's `onDrop` callback is called once on release with normalized 0–10000 coords (or null when released outside the map). This rule is load-bearing — PATCH-on-pointermove would flood the backend at 60 Hz.
- Draggable surfaces need `touch-action: none` so iOS doesn't intercept the gesture as a scroll. Both the canvas (`.floor-plan`) and sidebar items already set this.
- The drop hit-test uses `document.elementFromPoint(e.clientX, e.clientY)` and checks `mapRef.current.contains(target)`. Dropping outside the map is a no-op (no PATCH); for removal use the Remove-from-map button on the selected-pin callout.

## Floor-plan image storage

- Per-panel floor-plan images live at `${FLOOR_PLAN_DIR:-/data/floor-plans}/<panelId>-<sha8>.<ext>` where `<sha8>` is the first 8 hex chars of the file's SHA-256. The hash-in-filename is **load-bearing**: it makes the static URL self-cache-busting, so PWAs can SWR-cache `/files/floor-plans/...` without manually purging on re-upload.
- The backend container has **read-write** access to that directory via the `./data:/data` bind-mount in `docker-compose.yml`. The proxy container has **read-only** access via `./data/floor-plans:/srv/files/floor-plans:ro`. Don't merge those into one mount — the read-only on the proxy side defends against a compromised reverse-proxy overwriting user files.
- The DB stores **filename only** (not a URL, not an absolute path) in `panels.floor_plan_filename`. Backend joins with `FLOOR_PLAN_DIR`; frontend joins with `/files/floor-plans/`. Storing a URL would couple the DB to the deployment topology.
- Accepted formats: PNG, JPEG, WebP. Sniffed by magic bytes (first 12 bytes). SVG is **explicitly rejected** (embedded `<script>` is an XSS vector).
- 10MB upload cap. Max dimension 10000×10000 (defensive against decompression bombs).
- Component coords (`components.pos_x`, `components.pos_y`) are **normalized 0–10000 integers** relative to the image's natural width/height at upload time. To render: `left = pos_x / 10000 * imageDisplayWidth`. If a user re-uploads a different-aspect image, existing coords stay valid relative to the *new* natural dimensions — i.e. they reproject to the new image's bounds. This is by design; we don't track per-image coord sets.

## Service-worker runtime cache (allow-list)

- Rule: **SWR (StaleWhileRevalidate) only for panel/component/breaker GET routes that are safe to render stale briefly.** Mutations (POST/PATCH/DELETE) are never cached. The allow-list lives in `packages/frontend/vite.config.ts` under `VitePWA.workbox.runtimeCaching`.
- Adding a route to the allow-list requires updating this file's rule with one sentence on *why* it's safe to stale.
- Stale entries expire after 1 hour. Mutations don't bust the cache directly; clients reload to pick up server state. If a write needs to bust SWR cache eagerly, that's its own feature — discuss before adding cache-bust logic.
- Routes that need fresh-on-every-read (e.g. health, future authn) belong in NetworkFirst, not SWR.

## Frontend routing

- `wouter` powers SPA routing. Routes are declared in `App.tsx`.
- Touch targets must be ≥44 CSS px tall (G8 mobile-first requirement). Use the existing utility patterns in `styles.css`.
- All fetches against the backend are **same-origin** (Caddy fronts both static and `/api/*`). No CORS, no hardcoded `localhost:3000`.

## Local development (`pnpm dev`)

`pnpm dev` at the repo root runs all three workspace packages in parallel via `pnpm -r --parallel`:

- `@he/shared` — `tsc --watch --preserveWatchOutput` rebuilds the shared `dist/` on save.
- `@he/backend` — `tsx watch --env-file=../../.env.dev` hot-restarts the Hono server.
- `@he/frontend` — Vite dev server with HMR + a proxy config that forwards `/api/*` and `/files/*` to `http://localhost:3000`.

Frontend dev URL: `http://localhost:5173/`. Backend dev URL: `http://127.0.0.1:3000`. Vite's proxy preserves the same-origin contract — code doesn't need to switch URLs between dev and prod.

`predev` script ensures `./data/floor-plans/` exists and runs an initial `@he/shared` build so the dependent packages have valid `.d.ts` to read from on first tick.

`.env.dev` (committed at repo root) overrides the docker defaults:
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/house_electricals`
  — points the dev backend at the local Postgres container
  (`docker-compose.dev.yml`, host port 5433 so it never clashes with a
  system Postgres on 5432).
- `FLOOR_PLAN_DIR=./data/floor-plans` (instead of `/data/floor-plans`)
- `DATA_DIR=./data` (where the auto-generated `.auth-secret` is written —
  in the container this defaults to `/data`)
- `HOST=127.0.0.1` (loopback only — dev mode doesn't expose to LAN)

Relational data lives in the dev Postgres container; only floor-plan
images + `.auth-secret` live under `./data/`. Start Postgres with
`docker compose -f docker-compose.dev.yml up -d`; wipe it (and the data
dir) with `docker compose -f docker-compose.dev.yml down -v` + `rm -rf
./data`. `./data/` is gitignored.

**`routes/dev-static.ts`** mounts `GET /files/floor-plans/:filename` on the backend. After the single-image consolidation this is the CANONICAL floor-plan serving path in both dev and prod — there is no nginx fronting the backend anymore; Hono is the only thing serving uploaded floor-plan images. The file kept its historical `devStaticRoutes` name; the logic was already production-grade (path-traversal hardened via filename sanitization + resolved-path-must-live-inside-dir check, immutable cache header).

**`routes/static-spa.ts`** mounts `GET /*` for the Vite-built SPA. Registered LAST so /api/v1/* and /files/floor-plans/* match first. Serves files from `PUBLIC_DIR` (default `/app/public` inside the runtime image) with MIME + cache headers (`max-age=31536000, immutable` for hashed assets, `no-cache` for HTML/manifest/SW). Falls back to `index.html` for any unmatched GET so wouter handles client-side routing. `/api/*` misses return JSON 404 (not the SPA index.html — JSON consumers would explode). `/files/*` misses return 404 directly (no SPA fallback for image URLs). In local dev with PUBLIC_DIR missing or empty, silently 404s everything — devs use Vite on its own port (5173) for the SPA.

The Vite dev proxy reads `process.env.BACKEND_DEV_URL` so contributors can point the dev frontend at a remote backend if they want.

## Single-image consolidation (post-publish)

The original cycle-33 architecture was two containers — `backend` (Hono +
SQLite) and `web` (nginx serving the Vite-built PWA + reverse-proxying
`/api/*` to backend). For the public release the two were collapsed into
**one container, one image, one Node process**: Hono serves the API, the
uploaded floor-plan images, AND the SPA bundle from a single port.

Why: end-users running a self-hosted personal app don't benefit from the
nginx-level static-serving micro-optimizations; the operational cost of
two containers (compose YAML complexity, separate logs, healthcheck
chains) wasn't worth it.

Architecture pins:
1. **Image is `house-electricals` (no `-backend`/`-web` suffix).**
   Tags: `latest` (moves with main), full commit SHA (rollback target),
   `vX.Y.Z` (on tagged releases).
2. **The image is built by `packages/backend/Dockerfile`** — multi-stage:
   `frontend-builder` (Vite build) + `backend-builder` (TS compile + pnpm
   deploy --prod) → `runtime` (distroless `nodejs22-debian12:nonroot`).
   Backend deploy artifact lives at `/app/`; frontend dist at
   `/app/public/`.
3. **PUBLIC_DIR env var** points the SPA route at the bundled frontend
   (default `/app/public`). Local dev leaves it unset; in that case
   `static-spa.ts` silently 404s and devs use Vite on port 5173.
4. **Container name `house-electricals`, port `${HOST_PORT:-8070}:3000`.**
   Both `docker-compose.yml` (build-from-source) and `compose.prod.yaml`
   (pull-from-GHCR) agree.
5. **`compose.prod.yaml` requires `IMAGE` in `.env`** via `${IMAGE:?…}`
   syntax so the operator can't accidentally pull a stale public
   maintainer image. There is NO default.

If a future cycle adds a true reverse-proxy need (e.g. a Caddy plugin
or split workload), revive a `web` service — but the default deploy
stays single-image. The cycle-33 ADR is superseded by this.

## Deployment

- One canonical deploy path: `docker compose up -d` from the repo root.
- **Two services**: `app` (the unified `house-electricals` image —
  distroless Node 22 + Hono + `pg`, distroless nonroot UID 65532) and
  `db` (`postgres:18-alpine`, container `house-electricals-db`, on the
  internal compose network only). `app` serves `/api/v1/*`,
  `/files/floor-plans/*`, and `/*` (SPA) on a single internal port (3000),
  mapped to `${HOST_PORT:-8070}` on the host, and connects to `db` via the
  `DATABASE_URL` both compose files derive from `POSTGRES_USER` /
  `POSTGRES_PASSWORD` / `POSTGRES_DB`. `app` waits on `db` via
  `depends_on: condition: service_healthy`.
- **No TLS in the stack.** Inside-the-container port 3000 maps to host
  `${HOST_PORT:-8070}`. HTTPS termination is the operator's responsibility
  — typically via an external Caddy or a Cloudflare Tunnel pointing at
  `http://localhost:${HOST_PORT}`.
- Persistent state lives in **two** places: the `he-pgdata` named volume
  (all relational data — owned by Postgres) and the `${DATA_PATH:-./data}`
  bind-mount (floor-plan images + `.auth-secret`, mounted at `/data` RW).
  Back up both together.
- Before first `up` on Linux: `sudo chown -R 65532:65532 ${DATA_PATH}`
  (the container runs as distroless nonroot UID 65532).
- Local browser testing: `http://localhost:8070/` works as a real PWA
  because `localhost` is a secure context regardless of TLS state.

## What NOT to do

- Don't reintroduce `node:sqlite` / `better-sqlite3` — persistence is
  PostgreSQL via `pg` (see the "Persistence is PostgreSQL" section at the
  top of this file).
- Don't add desktop-only CSS — this is a mobile-first PWA.
- Don't add CORS middleware — same-origin via Caddy.
- Don't write to VISION.md from inside a meta-ralph cycle.
- Don't bypass the `Repository` interface to query the database directly from routes.
- Don't switch the URL convention without an ADR update here first.
