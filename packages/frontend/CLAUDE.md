# Frontend package — agent notes

Per-package context for `@he/frontend`. Read the root `CLAUDE.md` first (it owns
the project-wide design-system contract, tokens, and most ADRs). This file
records frontend-only conventions that future cycles must respect.

## Design-system reuse is mandatory (2026-05)

The app has a token-driven design system (root `CLAUDE.md` → "Design system
(G11)"). When building or changing UI, **compose the existing primitives — do
not hand-roll markup that one already covers.**

1. **Use the `ui/` primitives instead of raw HTML controls.** Reach for the
   primitive, not a bespoke `<button>`/`<input>`/`<select>`:
   - `Button` (variants: primary/secondary/danger/ghost; `block`, `busy`,
     `leadingIcon`) and `IconButton` — never a styled raw `<button>` for
     actions.
   - `Input`, `Textarea` (register-spread compatible) and `Select`
     (controlled `value`/`onChange`, `options`/`optGroups`, placeholder→null)
     and `Checkbox` (controlled) — never a raw `<input>`/`<select>`/
     `<textarea>` in a form. They carry the label/error/hint slots, the 44px
     touch target, the focus ring, and a11y wiring for free. Surface server/
     validation errors through the primitive's `error` prop.
   - `Combobox` for typeahead single-select; `Modal` (+ `useModal` for
     imperative confirm/prompt/pick) for dialogs; `Card`/`CardHeader`/… for
     surfaces; `Tooltip` for informational tooltips; `EmptyState` for empty
     lists; `Spinner` for inline loading.
   - Icons: `lucide-react` only. Toasts: `ui/toast` only (never import
     `sonner` directly outside `ui/toast.tsx`).

2. **Tokens are the only source of style values.** Never hard-code a color/
   spacing/radius/shadow/motion literal — read the `--token` (root rule,
   enforced by `lint:illustrations` + `lint:motion`). Do not add new token
   *names* without an ADR (cycle-11/17/20 rule).

3. **If you catch yourself duplicating a primitive's internals, extract a
   shared hook/component instead of copy-pasting.** Canonical example:
   `hooks/usePopoverPosition.ts` (portal popover flip-up/down + viewport clamp
   + scroll/resize re-anchor) is shared by `ui/Combobox` and
   `components/BreakerComboField`. The bar to clear: if a second consumer
   needs the same logic, it goes in `ui/` (primitive) or `hooks/` (behavior),
   not a private re-implementation.

4. **Where things live:** domain-agnostic primitives → `ui/`. Domain-aware
   composites (they know about panels/breakers/components/the API) →
   `components/`. Screens → `screens/`. Reusable stateful behavior → `hooks/`.

5. **When a primitive almost-but-not-quite fits**, prefer extending the
   primitive (a new prop / render slot) over forking a bespoke copy — UNLESS
   the change would bloat a heavily-used shared primitive for one caller's
   edge case. In that case, build the bespoke composite in `components/` and
   leave a comment noting the possible future consolidation (e.g.
   `BreakerComboField` is a richer breaker-specific picker that deliberately
   does not overload the generic `Combobox` with sections/pills/footer slots).

Reviewers (and the council) should treat a raw `<button>`/`<input>`/`<select>`
in a screen or component as a smell to justify or replace.
