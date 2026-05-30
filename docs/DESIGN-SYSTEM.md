# House Electricals — Design System

> **Status:** Source-of-truth reference for the token-driven design system (G47).
> **Scope:** the frontend PWA (`packages/frontend`). This document *describes*
> the system that already exists — it does not propose a redesign.
>
> **Authoritative files** (this doc summarizes them; when they disagree, *they*
> win):
> - Tokens: [`packages/frontend/src/ui/tokens.css`](../packages/frontend/src/ui/tokens.css)
> - Primitive barrel: [`packages/frontend/src/ui/index.ts`](../packages/frontend/src/ui/index.ts)
> - Global CSS / BEM classes: [`packages/frontend/src/styles.css`](../packages/frontend/src/styles.css)
> - Pinned rules + per-cycle ADRs: [`CLAUDE.md`](../CLAUDE.md) (the "Design system (G11)" section and every `cycle-NN` pin)

---

## 1. Overview & philosophy

House Electricals is a **mobile-first, installable PWA** for mapping a home's
electrical system. The UI is built on a small, deliberately-boring design
system with four load-bearing principles:

1. **Token-driven.** Every color, space, radius, shadow, type-step, and motion
   value is a CSS custom property defined once in `tokens.css`. **Never
   hard-code a `#hex`, a `px` spacing, a radius, or a shadow in a component —
   read a token.** This is enforced by convention + code review, and by grep
   gates in the build chain (e.g. `src/ui/illustrations/` rejects any hex
   literal; `lint:motion` rejects bare easing literals in `styles.css`).

2. **Mobile-first, touch-first.** The base layout targets a phone. Interactive
   elements meet the **44px** minimum touch target (`--touch-target`, the
   WCAG / iOS floor). Desktop is a progressive enhancement via a small set of
   breakpoints (see §3.9).

3. **Dual-theme.** A `dark` (default) and `light` theme ship from the same
   token *names* — only the *values* change. The active theme is set by adding
   a `.light` class to `<html>` via `ThemeProvider`
   (`contexts/ThemeContext.tsx`, storage key `he.theme`, modes
   `light | dark | system`). Components never branch on theme; they read tokens
   and adapt for free. `prefers-reduced-motion` zeroes all motion durations the
   same way.

4. **Two component layers — `ui/` vs `components/`.**
   - **`packages/frontend/src/ui/` — generic primitives.** Reusable, domain-
     agnostic building blocks (Button, Card, Modal, Input, Badge…). They know
     nothing about breakers, panels, or floors. Token-only styling. Exported
     from the `ui/index.ts` barrel; screens import `from '../ui/index.js'`.
   - **`packages/frontend/src/components/` — domain compositions.** Components
     that *compose* primitives and *do* know the domain (BreakerForm,
     BreakerRow, ComponentForm, ComponentTypeIcon, ProtectionBadge,
     PhotoStrip…). They live in `components/`, not `ui/`, and are imported by
     their own path (not the barrel).
   - Rule of thumb: *if it would make sense in a todo app, it's a `ui/`
     primitive; if it mentions electricity, it's a `components/` domain
     component.*

### The frozen-names rule (read before touching tokens)

> **Token VALUES may change between cycles; token NAMES are frozen.**

This is the **cycle-11/17/20 rule**, re-pinned in nearly every cycle. Renaming
an existing token (e.g. `--color-bg-canvas`, `--space-4`, `--radius-md`)
requires an explicit ADR because dozens of CSS rules + primitives read it by
name. Adding a *net-new* token name is allowed when a genuinely new need
appears (e.g. the cycle-59 `--color-warning*` amber family, the cycle-21
`--shadow-tabs`) — but it must be named clearly and documented in `tokens.css`.

---

## 2. Token reference

All tokens live in `:root` in `tokens.css`; light-theme overrides live in
`:root.light`. Values below are **current** — treat `tokens.css` as canonical
if this drifts.

### 2.1 Color — backgrounds (`--color-bg-*`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg-canvas` | `#1a1917` | `#faf8f5` | App background (the page) |
| `--color-bg-surface` | `#252420` | `#ffffff` | Cards, panels, rows |
| `--color-bg-surface-raised` | `#34322c` | `#ffffff` | Modals, popovers, menus (lifted over surface) |
| `--color-bg-hover` | `#38352f` | `#f5f0eb` | Hover stop on rows/menu items |
| `--color-bg-input` | `#15140f` | `#ffffff` | Form field background (sits *below* the card) |
| `--color-bg-overlay` | `rgba(15,14,12,.78)` | `rgba(44,42,39,.42)` | Modal scrim |

### 2.2 Color — foreground (`--color-fg-*`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-fg-default` | `#f0ebe6` | `#2c2a27` | Body text |
| `--color-fg-strong` | `#ffffff` | `#1a1816` | Emphasis / headings |
| `--color-fg-muted` | `#9a958e` | `#8a8279` | Secondary text, meta (AA-verified) |
| `--color-fg-subtle` | `#6f6a64` | `#a8a098` | De-emphasized chrome |
| `--color-fg-on-accent` | `#ffffff` | `#ffffff` | Text on an accent fill |

### 2.3 Color — border (`--color-border-*`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-border-subtle` | `#3a3732` | `#e8e0d8` | Default hairline |
| `--color-border-strong` | `#4d4942` | `#d4ccc1` | Hover/focused edges, menu outlines |
| `--color-border-focus` | `#7a9e8a` | `#5f7a6a` | Focus ring color (= the sage primary) |

### 2.4 Color — accent / brand (`--color-accent*`)

The **brand is sage green** (sourced from HousesTracker's `--color-primary`).
Powers primary buttons, links, focus rings, selected tabs, the count badge.

| Token | Dark | Light |
|---|---|---|
| `--color-accent` | `#7a9e8a` | `#5f7a6a` |
| `--color-accent-hover` | `#8eb29c` | `#6f8c7b` |
| `--color-accent-active` | `#688876` | `#4e6759` |
| `--color-accent-subtle` | `rgba(122,158,138,.14)` | `rgba(95,122,106,.12)` |
| `--color-accent-border` | `rgba(122,158,138,.4)` | `rgba(95,122,106,.4)` |

> **Gotcha (load-bearing):** the brand maps from HousesTracker's `--color-primary`,
> **never** HT's `--color-accent` (which is a neutral surface tint). Getting this
> wrong turns every primary button cream-beige. See the mapping table comment at
> the top of `tokens.css`.

### 2.5 Color — danger / success / warning

| Family | Tokens | Use |
|---|---|---|
| **danger** (warm coral) | `--color-danger`, `-hover`, `-subtle`, `-border` | Destructive actions, errors, the "warn" badge tone |
| **success** (= sage) | `--color-success`, `-subtle`, `-border` | Positive feedback (harmonizes with brand) |
| **warning** (amber) | `--color-warning`, `-hover`, `-subtle`, `-border` | Safety flags: `critical` device flag, GFCI/AFCI protection badges, monthly-test reminders |

Danger dark `#c47a5a` / light `#c47a5a` (unified). Warning dark `#d97706` /
light `#b45309` (deeper amber for AA on cream). The warning family is
House-Electricals-original (cycle-59) — HousesTracker only had sage + coral.

### 2.6 Spacing — `--space-N` (4px base scale)

| Token | px | Token | px |
|---|---|---|---|
| `--space-0` | 0 | `--space-5` | 20 |
| `--space-1` | 4 | `--space-6` | 24 |
| `--space-2` | 8 | `--space-8` | 32 |
| `--space-3` | 12 | `--space-10` | 40 |
| `--space-4` | 16 | `--space-12` | 48 |
| | | `--space-16` | 64 |

Use spacing tokens for padding, gap, and margin. Never a bare `px` value.

### 2.7 Type ramp

- **Family:** `--text-family` = Plus Jakarta Sans (self-hosted via
  `@fontsource/plus-jakarta-sans`, imported in `main.tsx`; Inter is the
  metric-compatible fallback). `--text-family-mono` for monospace.
- **Sizes** `--text-size-*`: `xs` 12px · `sm` 13px · `base` 15px · `md` 16px ·
  `lg` 19px · `xl` 23px · `2xl` 30px.
- **Weights** `--text-weight-*`: `regular` 400 · `medium` 500 · `semibold` 600
  · `bold` 700.
- **Leading** `--text-leading-*`: `tight` 1.18 · `snug` 1.4 · `normal` 1.55.
- **Tracking** `--text-tracking-tight` `-0.011em` (display headings) ·
  `--text-tracking-normal` 0.

### 2.8 Radius / shadow / motion / layout

| Group | Tokens |
|---|---|
| **Radius** | `--radius-sm` 6px · `--radius-md` 12px · `--radius-lg` 16px · `--radius-xl` 22px · `--radius-pill` 999px |
| **Shadow** | `--shadow-sm` · `--shadow-md` · `--shadow-lg` (multi-stop, layered) · `--shadow-focus` (sage halo, used as `box-shadow` focus ring) · `--shadow-tabs` (upward lift for BottomTabs) |
| **Motion** | `--motion-duration-fast` 120ms · `-base` 180ms · `-slow` 240ms · `--motion-ease-out` · `--motion-ease-in-out` (cubic-beziers) |
| **Layout** | `--touch-target` 44px · `--layout-max-w` 640px (→ 1200px at ≥960px) · `--layout-bottom-tabs-h` 64px |

> **Reduced motion:** `@media (prefers-reduced-motion: reduce)` sets all
> `--motion-duration-*` to `0ms`. Components read the duration tokens and get
> this for free — never re-check the media query yourself. Some keyframes
> (spinner, theme-swap) also have explicit reduced-motion carve-outs.

---

## 3. Component catalog (`ui/` primitives)

Every primitive is **token-only** (no inline colors), exported from
`ui/index.ts`, and meets the 44px touch floor where interactive. Props below
are pulled from the actual `.tsx` sources — only documented props exist.

### 3.1 Layout / shell

#### `AppShell` — top-level chrome
Wraps every routed screen: a top bar (`BuildingSwitcher`), the constrained
content area, the `VersionPill`, and the `BottomTabs`. Props: `children`,
`fullBleed?` (removes inner content padding so a map can paint edge-to-edge;
tabs still render). The **escape hatch** for full-bleed routes (FloorEdit,
`/print`) is *routing-level* — declare them OUTSIDE the AppShell-wrapped
`<Switch>` in `App.tsx`, not via a prop. `APP_TABS` (exported) is the canonical
4-tab definition: **Map · Panels · Test · Library**.

#### `BottomTabs` — mobile bottom nav
Receives `tabs: Tab[]` + optional `trailing` ReactNode (the account menu cell).
Each `Tab` = `{ label, href, icon, isActive(location) }`. Active state is
derived via each tab's `isActive` predicate (one tab can cover several routes),
never `href` equality. Tab count is surfaced to CSS via `--bottom-tabs-count`
so the grid auto-adapts.

#### `ScreenHeader` — sticky per-screen header
Props: `title` (required), `back?` (wouter path for the back arrow),
`subtitle?`, `children` (right-side action area). Reserves right-edge padding
so header CTAs don't collide with fixed top-right controls.

#### `Card` (+ compound parts)
The surface primitive: `<Card variant="default" | "flat">` (`flat` drops the
shadow, for use inside scrollers). Compose with siblings:
- `CardHeader` — flex row (title block left, actions right)
- `CardTitle` — heading; polymorphic via `as="h2" | "h3" | "h4"` (default `h2`)
- `CardSubtitle` — muted secondary `<p>`
- `CardActions` — right-docked action row (`margin-left:auto`)

> Do: use `CardTitle as="h3"` when the card sits under a higher-level heading.
> Don't: reach for `.section-title` *inside* a Card — that class is for
> non-Card section dividers (it stays valid for its 33+ existing uses).

### 3.2 Forms

#### `Button`
`variant`: `primary` (default) · `secondary` · `danger` · `ghost`.
`size`: `md` (default, 44px) · `sm` (inline, for rows that already meet 44px).
Other props: `block?` (full-width), `leadingIcon?` (lucide node), `busy?`
(prepends a `Loader2` spinner + `aria-busy`; does **not** auto-disable — caller
still owns `disabled`). Pattern: `<Button busy={saving} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>`.

#### `IconButton`
Square icon-only 44×44 button. `icon` (required), `aria-label` (**required by
the type** — that's the point), `variant`: `default` · `primary` · `danger` ·
`ghost`. Use `variant="danger"` + lucide `Trash2` for the per-row destructive
convention (see §4.3).

#### `Input` / `Textarea`
Native field wrapped with `label` / `error` / `hint` slots, `useId()` wiring,
`aria-invalid` + `aria-describedby`. **Register-spread compatible** —
`{...register('field')}` works (RHF). `Input` adds `leadingIcon?`. `Textarea`
`rows` defaults to 4 and inherits the app font. Pass `label={null}` to skip the
visible label (then supply `aria-label` yourself).

#### `Select`
**Controlled** (not register-spread — cycle-50 Checkbox precedent). Generic
over `<T extends string>`. Props: `value: T | null`, `onChange(next: T | null)`,
either `options: SelectOption<T>[]` OR `optGroups: SelectOptGroup<T>[]` (native
`<optgroup>`), `placeholder?` (empty row maps to `null` on select — hoists the
old `setValueAs` boilerplate), `label/error/hint`, `disabled`. A lucide
`ChevronDown` renders inside the control (theme-tracks; no background SVG).

#### `Checkbox`
**Controlled.** Props: `checked`, `onChange(next: boolean)`, `label?`,
`ariaLabel?`, `disabled?`, `testId?`. The whole `<label>` is the ≥44px hit
area; the native input is visually hidden but screen-reader announced.

#### `Badge` *(G47)*
Small inline pill for counts, statuses, and flags. Props: `tone` (`count` ·
`warn` · `critical` · `protection`; default `count`), `children`, plus any
`HTMLAttributes<span>` via `...rest` (so `data-testid`, `tabIndex`, `title`
pass through), and `className` for extra layout classes. Renders
`<span className="badge badge--{tone} …">` — **identical DOM** to the inline
form it replaces (it formalizes the long-standing `.badge` / `.badge--*` CSS,
it does not restyle). Tones map 1:1 to the modifier classes (count → accent;
warn → danger; critical/protection → warning amber). The domain
`<ProtectionBadge>` (in `components/`) is the GFCI/AFCI wrapper that sets the
`data-protection` contract on top of the `protection` tone.

#### Filter / sort (cycle-60, ported from HousesTracker)
- **`FilterTriggerButton`** — pill trigger; `onClick`, `active?`, `count?`
  (renders a circular badge), `label`, `icon?` (lucide; default `Filter`).
- **`FilterPopover`** — fixed-position, viewport-clamped panel anchored at
  `{top,left}`. Carries `data-filter-popover` for the `useFilterPopover`
  outside-click handler.
- **`Combobox<T>`** — single-select typeahead. `value: T | null`,
  `onChange`, `options: ComboboxOption<T>[]`, `placeholder?`, `allowClear?`
  (default true), `emptyMessage?`, `equals?`. Listbox is portal-mounted to
  `document.body` with `data-portal-popover` (so a parent FilterPopover doesn't
  treat its clicks as outside-clicks). Keyboard nav via `useComboboxKeyboard`.
- **`SortDropdown<TBy>`** — single-value sort menu; `options: SortOption[]`,
  `currentSortBy`, `currentSortOrder`, `onSort`.

### 3.3 Overlays / modals

#### `Modal` — base primitive
Props: `open`, `onClose`, `title`, `children`, `footer?`, `headerAction?`
(top-right, before the ✕), `closeOnOverlay?` (default true), `showCloseButton?`
(default true), `testId?` (default `'modal'`), `presentation?`. ESC + overlay
click + ✕ all dismiss; focus is trapped/restored; body scroll locks.
`presentation="sheet"` opts into a **mobile bottom-sheet** below 720px (with a
functional swipe-down-to-dismiss drag handle); above 720px it falls back to
centered automatically. Default `'centered'` is byte-identical to the original.

#### `ConfirmModal` / `PromptModal` / `PickerModal`
Higher-level dialogs over `Modal`. **Most callers should use the `useModal()`
hook** instead of rendering these directly:
- `confirm({ title, message, confirmLabel?, cancelLabel?, confirmVariant? })` → `Promise<boolean>`
- `prompt({ title, label, message?, defaultValue?, placeholder? })` → `Promise<string | null>` (returns a trimmed, non-empty string; empty submit is disabled)
- `pick<T>({ title, options, message?, emptyMessage? })` → `Promise<T | null>`
- Render `{modalNode}` at the screen root. One modal per `useModal()` instance
  (concurrent calls replace, resolving the prior with cancel-equivalent).

> `window.prompt` / `window.confirm` are **banned** — use `useModal()`.

#### `ImpactModal` (domain-aware, lives in `ui/`)
Read-only "what loses power / control if I flip this breaker?" view. Props:
`open`, `breakerLabel`, `items: ImpactItem[]`, `switchLosses?`, `floorById`,
`onClose`. A precomputed snapshot (no simulate-flip) — TestPanelScreen remains
the interactive surface.

#### `ServiceLogModal` (domain-aware, lives in `ui/`)
Dated service-log timeline for a breaker or component. **Always opens in a base
`Modal`** (parent owns `open` state — NOT `useModal`). Props: `open`,
`parentLabel`, `parentType`, `entries`, `onAddEntry`, `onDeleteEntry`,
`onClose`. testids pinned in CLAUDE.md (G40).

### 3.4 Feedback

- **`Toaster` / `toast`** — `sonner`, consumed *only* via `ui/toast.tsx` (the
  single swap point). `ThemedToaster` binds sonner's theme to `he.theme` and is
  mounted once in `main.tsx` (outside the route Switch, so escape-hatch routes
  can toast too). **Never import from `sonner` directly** outside `ui/toast.tsx`.
- **`Spinner`** — inline loading indicator (lucide `Loader2` + `role="status"`
  + visually-hidden label). Props: `size?` (default 16), `label?` (default
  "Loading"). Static (no spin) under reduced-motion.
- **`Skeleton`** — shimmer placeholder. `variant`: `row` (default, repeat via
  `count`) · `card` · `bar` (`width`/`height`).
- **`EmptyState`** — list-empty placeholder. Pass **exactly one** of `icon`
  (lucide) OR `illustration` (a bespoke SVG from `ui/illustrations/`) — they're
  mutually exclusive (runtime-guarded). Plus `title`, `description?`, `action?`.
  See the icon-vs-illustration partition rule in §4.4.
- **`Tooltip`** — custom tooltip replacing native `title=""` for *informational*
  content. `content`, `side?` (`top`/`bottom`, auto-flips), `longPressMs?`
  (touch), `testId?`. Trigger must be exactly one element (cloned to thread
  `aria-describedby`). Portal-mounted; `role="tooltip"`. **Not** a substitute
  for `aria-label` (that's the NAME; the tooltip is the DESCRIPTION).

### 3.5 Data display

- **`PanelVisualization`** — the breaker-panel diagram. Props: `panel`,
  `breakers`, `onSlotClick?`, `subpanelsByFeederBreakerId?`,
  `highlightedBreakerId?` (permanent active ring), `loadByBreakerId?`. Renders
  the slot grid with vertical/horizontal orientation, double-pole spanning,
  tandem split sub-cells, protection + load badges, and the `#breaker-<id>`
  deep-link pulse target (`id="slot-cell-<id>"`).
- **`FloorPlanVectorOverlay`** — read-only SVG of a floor's walls + rooms,
  inside `.floor-plan` (`viewBox="0 0 10000 10000" preserveAspectRatio="none"`).
  Props: `walls`, `rooms?`, `selectedWallId?`, `selectedRoomId?`, `ghostWall?`,
  `ghostRoom?`, `transform?` (pan/zoom).
- **`SelectionBar`** — bottom toolbar shown when ≥1 row is selected; *replaces*
  BottomTabs while active (`body:has(.selection-bar) .bottom-tabs{display:none}`).
  Props: `count`, `onClear`, `actions`. Mount via `createPortal(…, document.body)`.
- **illustrations** — `NoPanels`, `NoFloors`, `NoComponents`, `NoBreakers`
  (`ui/illustrations/`). `forwardRef<SVGSVGElement>`, viewBox `0 0 140 140`,
  `currentColor` + `var(--color-accent)` only (no hex literals — grep-gated).

### 3.6 Domain helpers exported from `ui/`

`MoveToBuildingButton` (`kind`/`id`/`name`) is a self-contained "Move to
building…" action — exported from the barrel for convenience but domain-aware
(owns its own `useModal` node, hidden when only one building exists).

---

## 4. Patterns & conventions

These are pinned in `CLAUDE.md`; this is a concise index — read the cited
section there for the full ADR.

### 4.1 Add-→-Modal (CLAUDE.md "Add-→-Modal pattern")
"Add X" on list screens = a `ScreenHeader` CTA (`open-add-<resource>`) that
opens a **base `Modal`** (`add-<resource>-modal`) containing the form — NOT an
always-visible card. The wrapper is the **base `Modal`, not `useModal()`** so a
recursive `useModal().prompt()` (e.g. a 409 name-collision retry) doesn't
replace+close it mid-create. EmptyState CTAs use `empty-state-add-<resource>`.

### 4.2 Base-Modal vs `useModal` stacking
The base `Modal` is a separate render surface with no singleton collision; a
`useModal()` confirm/prompt can stack *on top* of an open base Modal. This is
the canonical way to layer a confirm over a sheet (BuildingsModal, etc.).

### 4.3 Per-row destructive affordance (CLAUDE.md "Per-row destructive")
Per-row delete = `IconButton variant="danger"` with lucide `Trash2` (icon-only)
— not a full red text button. The full `Button variant="danger"` text form is
reserved for **solo-context** destructive bars ("Delete this panel", the
FloorEdit "Danger zone"). High-volume sweep deletes go through the
`SelectionBar` bulk flow.

### 4.4 EmptyState — illustration vs icon (CLAUDE.md cycle-76/77)
- **`illustration`** = first-impression list-empty (the user arrived and the
  only reason it's empty is *no data yet*).
- **`icon`** = filtered-empty (a filter matched zero rows), error states
  ("Floor not found"), selection placeholders ("Nothing selected"), and
  mobile-hidden surfaces.

### 4.5 Optimistic write paths (CLAUDE.md "Frontend write paths")
Idempotent single-item PATCHes go through `hooks/useOptimisticPatch.ts` (local
update immediately; per-id pending + error tracking; retry w/ backoff;
last-write-wins). Don't fork the queue — import the hook.

### 4.6 Undoable delete (CLAUDE.md "Undoable delete")
Destructive deletes use `hooks/useUndoableDelete.ts` — a 30s deferred-delete
window with a sonner Undo toast (`deleteWithUndo` / `deleteManyWithUndo`). The
pending queue (`lib/pendingDeletes.ts`) is a module-level singleton so an
in-flight undo survives route changes.

### 4.7 testid conventions
Primitives forward an optional `testId` / `data-testid` (opt-in; no default
except where pinned, e.g. `Modal` defaults to `'modal'`, the higher-level
dialogs to `confirm-modal` / `prompt-modal` / `picker-modal`). Read-only e2e
hooks (`data-*` attributes that no behavior depends on) may be renamed only by
updating the matching `e2e/*.spec.ts` in the same change. Many testid contracts
are pinned per-cycle in CLAUDE.md (service-log, three-way, bulk-actions, etc.) —
preserve them.

### 4.8 Icons
**`lucide-react` is the canonical icon library.** Do not add a second icon set.
Inline SVGs remain fine for one-off *illustrations* (EmptyState art), but
anything that *is* an icon uses lucide.

---

## 5. Contributing to the design system

### Adding a `ui/` primitive
1. Create `packages/frontend/src/ui/<Name>.tsx`. `forwardRef` where a ref is
   useful; type props with a `<Name>Props` export.
2. **Token-only styling.** Add a BEM-ish class tree in `styles.css` that reads
   existing tokens. **Do not add new token NAMES** (the cycle-11/17/20 rule);
   values-only tweaks are fine.
3. Meet **44px** for anything interactive.
4. Wire accessibility: labels via `useId()`, `aria-*` as appropriate, focus
   handling for overlays.
5. Add an opt-in `testId` / `data-testid` pass-through if e2e will target it.
6. Export from `ui/index.ts` (the barrel — keep it the only public surface).
7. **Verify the gate** (§6) — typecheck + build under the perf budget; run any
   e2e spec covering touched screens.

### `ui/` primitive vs `components/` domain component — which?
- Generic, domain-agnostic, reusable across hypothetical apps → **`ui/`**.
- Knows about breakers/panels/floors/components, composes primitives → **`components/`**.
  (e.g. `ProtectionBadge` lives in `components/` because it encodes GFCI/AFCI
  domain semantics on top of the generic `Badge`.)

### What NOT to do
- Don't hard-code a color/space/radius/shadow/motion value — read a token.
- Don't rename an existing token (ADR required).
- Don't add desktop-only CSS — mobile-first.
- Don't import from `sonner` outside `ui/toast.tsx`.
- Don't introduce a second icon library.
- Don't add a heavy tooling dependency (see §7 re: Storybook) without a perf
  re-check + ADR.

---

## 6. Verify gate

Before committing any design-system change:

```sh
pnpm --filter @he/frontend typecheck
pnpm --filter @he/frontend build   # initial PWA gzipped entry JS MUST stay ≤ 200 KB
```

**Perf budget:** "initial PWA gzipped JS" = the entry-chunk `gzip:` size(s)
printed by `vite build` (the service worker + workbox runtime are excluded —
cached separately). Budget **≤ 200 KB**. (At G47 the entry JS gz is ~158 KB.)

If you extracted/changed a primitive, also run the e2e spec(s) covering the
touched screens, e.g.:

```sh
cd packages/frontend
pnpm exec playwright test smoke --project=desktop-1440x900
```

(`he-postgres` on `:5433` must be up — `docker compose -f docker-compose.dev.yml up -d`.)

---

## 7. Future extraction opportunities (documented, not built)

Candidates audited during G47 that are **deferred** (each carries some
rendered-output or contract risk and is not worth forcing for zero visual
change today):

- **`<Badge>` extension to the `critical` + `protection` call sites.** The
  generic `<Badge>` already supports `tone="critical"` and `tone="protection"`.
  The remaining inline `badge--critical` spans (ComponentsScreen, TestPanelScreen,
  ImpactModal) carry `data-testid="badge-critical"` + `tabIndex` + an inline
  lucide icon + a wrapping `Tooltip`; converting them is *possible* via `...rest`
  but adds churn around the e2e contract for no visual gain. `ProtectionBadge`
  could re-implement on top of `<Badge tone="protection">` similarly. Left as-is
  intentionally — the generic primitive exists when a future cycle wants it.
- **A `<CountPill>` / metric-row helper.** Landing screens (TestHome, MapLanding)
  render "N breakers · Last verified …" meta lines with bespoke markup. They're
  similar but not *identical* (different separators, icons, link targets), so a
  shared helper would need a flexible-enough API to be worth it. Defer until a
  third near-identical consumer appears.
- **A living component gallery (Storybook or similar).** Would be genuinely
  useful as a visual catalog, but Storybook adds large devDeps and a parallel
  build — out of scope for a self-hosted personal app on a tight perf budget.
  If desired later, prefer a lightweight in-repo `/styleguide` route over a
  heavyweight tool, and re-check the perf budget.

---

*Sources for the documentation-structure approach (token reference + per-component
anatomy/variants/usage/do-don't + contribution guidelines): industry design-system
docs guidance — e.g. [Carbon's anatomy/usage/accessibility per-component template](https://www.uxpin.com/studio/blog/design-system-documentation-guide/)
and [design-system documentation best practices](https://www.magicpatterns.com/blog/design-system-documentation).*
