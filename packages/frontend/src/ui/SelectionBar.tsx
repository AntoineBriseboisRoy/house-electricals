import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

/**
 * SelectionBar — G42(f) cycle-50.
 *
 * Bottom-of-screen toolbar shown when ≥1 row is selected. Replaces (NOT
 * stacks on top of) the BottomTabs while active — handled in styles.css
 * via `body:has(.selection-bar) .bottom-tabs { display: none; }`. The bar
 * fills the same vertical footprint (`--layout-bottom-tabs-h` + safe-area
 * inset) so the rest of the layout doesn't shift.
 *
 * Caller responsibilities (per CLAUDE.md G42(f) ADR):
 *  - Mount via `createPortal(<SelectionBar … />, document.body)` from the
 *    consuming screen — keeps the bar at the document root so the
 *    `body:has(.selection-bar)` CSS selector matches.
 *  - Provide actions as ReactNode (typically <Button>s).
 *  - Provide `onClear` for the leading ✕ button.
 */

export type SelectionBarProps = {
  count: number;
  onClear: () => void;
  actions: ReactNode;
};

export const SelectionBar = ({
  count,
  onClear,
  actions,
}: SelectionBarProps): JSX.Element => (
  <div
    className="selection-bar"
    role="toolbar"
    aria-label={`${count} selected`}
    data-testid="selection-bar"
  >
    <button
      type="button"
      className="selection-bar__clear"
      onClick={onClear}
      aria-label="Clear selection"
      data-testid="selection-bar-clear"
    >
      <X size={18} strokeWidth={2.25} aria-hidden="true" />
    </button>
    <span className="selection-bar__count">
      <strong data-testid="selection-bar-count">{count}</strong> selected
    </span>
    <div className="selection-bar__actions">{actions}</div>
  </div>
);
