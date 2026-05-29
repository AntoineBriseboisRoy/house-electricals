import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLocation } from 'wouter';
import type { Breaker, Panel, ProtectionKind, TandemHalf } from '@he/shared';
import type { BreakerLoad } from '../lib/load.js';

/**
 * Visual diagram of a breaker panel (G18).
 *
 * Slot layout invariants pinned in CLAUDE.md:
 *
 * - Slot numbering starts at 1 and maps to `breaker.slotPosition` where
 *   present. Breakers with `slotPosition === null` are NOT rendered in the
 *   grid (they show in the list view instead).
 * - **Vertical** orientation = 2-column grid. Slots 1,2 in the top row,
 *   3,4 in the next, etc. This matches a real residential panel where
 *   slot 1 is top-left and slot 2 is top-right of a tall narrow box.
 * - **Horizontal** orientation = 2-row grid (rows: top = odd slot numbers,
 *   bottom = even). The same logical pairing, rotated.
 * - **Double-pole breakers** (`poles === 'double'`) visually span the NEXT
 *   slot below them (vertical) or to the right (horizontal). That next
 *   slot is hidden (rendered empty).
 * - **Tandem breakers** stay 1 slot but get a stripe-pattern background.
 * - **Empty slots** render as "— spare —" placeholders.
 *
 * Clicking a slot invokes `onSlotClick(slotN, breakerOrNull)`.
 */

export type PanelVisualizationProps = {
  panel: Panel;
  breakers: readonly Breaker[];
  /** G34: when the user clicks an EMPTY tandem half (e.g. the bottom of a
   *  pair that has half-a filled), `tandemHalf` carries the half they
   *  tapped ('a' or 'b'). The parent uses it to pre-fill the add-breaker
   *  form with poles=tandem + that half. Undefined for all non-tandem clicks
   *  (single/double cells, regular empty slots). */
  onSlotClick?: (
    slot: number,
    breaker: Breaker | null,
    tandemHalf?: TandemHalf
  ) => void;
  /** G39 cycle-56 — map from feeder breaker id → subpanel that breaker
   *  feeds. When a slot's breaker is a feeder, we render a small "→
   *  Subpanel Name" chip linking to that subpanel's detail page. */
  subpanelsByFeederBreakerId?: ReadonlyMap<string, Panel>;
  /** Refactor 2026-05 — when set, the matching slot button gets a permanent
   *  `panel-viz__slot--active` class (solid accent border + lifted bg). Used
   *  by the Map drawer's breaker-context mini-viz to mark "this is THE slot
   *  controlling the selected component" without using the 1.5s self-clearing
   *  hash pulse (which is for transient deep-link feedback). Independent of
   *  the cycle-22 G23 `#breaker-<id>` hash mechanism — they can coexist. */
  highlightedBreakerId?: string | null;
  /** 2026-05 — per-breaker load summary, keyed by breaker id. When a slot's
   *  breaker has known load (watts > 0), a compact "Z%" chip renders in the
   *  slot, colored amber > 80% / red > 100%. */
  loadByBreakerId?: ReadonlyMap<string, BreakerLoad>;
};

type SlotCell =
  | { kind: 'breaker'; n: number; breaker: Breaker; span: 1 | 2 }
  | {
      kind: 'tandem';
      n: number;
      /** G34: tandem slot can have 0, 1, or 2 halves populated. Each half
       *  is its own breaker row in the DB. */
      halfA: Breaker | null;
      halfB: Breaker | null;
    }
  | { kind: 'empty'; n: number }
  | { kind: 'hidden'; n: number };

const buildSlots = (panel: Panel, breakers: readonly Breaker[]): SlotCell[] => {
  // G34: a slot can host TWO tandem halves; track them per-slot.
  type SlotEntry = {
    nonTandem: Breaker | null;
    tandemA: Breaker | null;
    tandemB: Breaker | null;
  };
  const byPosition = new Map<number, SlotEntry>();
  const ensure = (n: number): SlotEntry => {
    let e = byPosition.get(n);
    if (e === undefined) {
      e = { nonTandem: null, tandemA: null, tandemB: null };
      byPosition.set(n, e);
    }
    return e;
  };
  for (const b of breakers) {
    if (b.slotPosition === null || b.slotPosition < 1 || b.slotPosition > panel.slotCount) {
      continue;
    }
    if (b.poles === 'tandem') {
      const half = b.tandemHalf ?? 'a';
      const entry = ensure(b.slotPosition);
      if (half === 'a') entry.tandemA = b;
      else entry.tandemB = b;
    } else {
      ensure(b.slotPosition).nonTandem = b;
    }
  }
  const cells: SlotCell[] = [];
  for (let n = 1; n <= panel.slotCount; n++) {
    if (cells[n - 1]?.kind === 'hidden') {
      continue; // already consumed by a double-pole above/left
    }
    const entry = byPosition.get(n);
    if (entry === undefined) {
      cells.push({ kind: 'empty', n });
      continue;
    }
    if (entry.nonTandem !== null) {
      const b = entry.nonTandem;
      if (b.poles === 'double' && n < panel.slotCount) {
        cells.push({ kind: 'breaker', n, breaker: b, span: 2 });
        cells.push({ kind: 'hidden', n: n + 1 });
      } else {
        cells.push({ kind: 'breaker', n, breaker: b, span: 1 });
      }
    } else if (entry.tandemA !== null || entry.tandemB !== null) {
      cells.push({
        kind: 'tandem',
        n,
        halfA: entry.tandemA,
        halfB: entry.tandemB,
      });
    } else {
      cells.push({ kind: 'empty', n });
    }
  }
  return cells;
};

/** G29 cycle-36 — narrow-viewport hook. The PWA is mobile-first; on a
 *  phone-narrow viewport (< 720px) a horizontal-orientation panel viz
 *  doesn't fit (24 slots × 96px = 1152px wide vs ~390px screen). Force
 *  the display to the 2-column vertical layout regardless of the panel's
 *  configured orientation. The canonical `panel.orientation` is unchanged
 *  — this is a render-time accommodation.
 *
 *  The 720px threshold is intentionally tighter than the 960px desktop-
 *  pivot used elsewhere: a tablet at 768-959px CSS-wide CAN comfortably
 *  display 12 horizontal columns with horizontal scroll. Below 720px we
 *  always go vertical. */
const useNarrowViewport = (): boolean => {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 719px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 719px)');
    const handler = (e: MediaQueryListEvent): void => setNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return narrow;
};

/** G37 cycle-68 — tiny GFCI/AFCI/DUAL pill rendered in the corner of a
 *  filled slot cell. Reuses the cycle-59 `--color-warning*` amber family
 *  (safety indicator tier; not danger, not accent). Renders as a static
 *  `<span>` (no behavior) since the slot itself is the click target. */
const protectionLabel = (kind: ProtectionKind): string =>
  kind === 'dual' ? 'DUAL' : kind.toUpperCase();

const ProtectionBadge = ({
  kind,
}: {
  kind: ProtectionKind;
}): JSX.Element => (
  <span
    className="panel-viz__protection-badge"
    data-testid="protection-badge"
    data-protection={kind}
    aria-label={`Protection: ${protectionLabel(kind)}`}
    title={
      kind === 'gfci'
        ? 'GFCI-protected — test monthly'
        : kind === 'afci'
          ? 'AFCI-protected — test monthly'
          : 'GFCI + AFCI (dual) — test monthly'
    }
  >
    {protectionLabel(kind)}
  </span>
);

/** 2026-05 — compact per-slot load chip. Shows the load percentage of the
 *  breaker's continuous capacity; colored amber > 80% / red > 100% via the
 *  data-load-status attribute. Hidden when there's no known load (watts 0).
 *  Static `<span>` — the slot itself is the click target. */
const LoadChip = ({ load }: { load?: BreakerLoad }): JSX.Element | null => {
  if (!load || load.watts <= 0) return null;
  const pct = Math.round(load.pct * 100);
  return (
    <span
      className="panel-viz__load-badge"
      data-testid="load-badge"
      data-load-status={load.status}
      title={`Estimated load ${Math.round(load.watts).toLocaleString()} W of ${Math.round(
        load.capacity
      ).toLocaleString()} W continuous capacity (${pct}%)`}
    >
      {pct}%
    </span>
  );
};

/** G39 cycle-56 — tiny chip rendered inside a slot cell when its breaker
 *  feeds a subpanel. Tap → navigate to that subpanel's detail page. Uses
 *  `e.stopPropagation()` so the underlying slot button's onClick (which
 *  would open the breaker editor) doesn't also fire.
 *
 *  Implemented as a `<span role="link">` rather than a wouter `<Link>` (which
 *  renders `<a>`) so we don't nest interactive elements inside the slot
 *  `<button>` (invalid HTML, breaks a11y). Navigation is handled imperatively
 *  via wouter's setLocation. */
const SubpanelBadge = ({
  subpanel,
  navigate,
}: {
  subpanel: Panel;
  navigate: (to: string) => void;
}): JSX.Element => (
  <span
    role="link"
    tabIndex={0}
    className="panel-viz__subpanel-chip"
    data-testid="panel-viz-subpanel-chip"
    data-subpanel-id={subpanel.id}
    onClick={(e) => {
      e.stopPropagation();
      navigate(`/panels/${subpanel.id}`);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/panels/${subpanel.id}`);
      }
    }}
    aria-label={`Open subpanel ${subpanel.name}`}
    title={`Feeds subpanel: ${subpanel.name}`}
  >
    <ArrowRight size={10} strokeWidth={2.5} aria-hidden="true" />
    <span className="panel-viz__subpanel-chip-name">{subpanel.name}</span>
  </span>
);

export const PanelVisualization = ({
  panel,
  breakers,
  onSlotClick,
  subpanelsByFeederBreakerId,
  highlightedBreakerId,
  loadByBreakerId,
}: PanelVisualizationProps): JSX.Element => {
  const cells = useMemo(() => buildSlots(panel, breakers), [panel, breakers]);
  const narrow = useNarrowViewport();
  const [, setLocation] = useLocation();
  // G29 cycle-36 — on a phone-narrow viewport, always render vertically.
  // Canonical panel.orientation stays for desktop / Print and for any
  // other consumer that cares about the user's chosen physical layout.
  const displayOrientation = narrow ? 'vertical' : panel.orientation;

  const cols = Math.ceil(panel.slotCount / 2);
  const gridStyle: CSSProperties =
    displayOrientation === 'vertical'
      ? {
          gridTemplateColumns: '1fr 1fr',
          gridAutoRows: 'minmax(64px, auto)',
        }
      : {
          // Horizontal: ceil(slotCount/2) columns × 2 rows. Slots 1,3,5,...
          // on top row; 2,4,6,... on bottom row.
          // G25 cycle-24 — `minmax(96px, 1fr)` so wide panels (24+ slots) get
          // a horizontal scroll bar instead of clipping past the viewport.
          // The .panel-viz--horizontal-scroll wrapper supplies the overflow.
          gridTemplateColumns: `repeat(${cols}, minmax(96px, 1fr))`,
          gridTemplateRows: 'minmax(64px, auto) minmax(64px, auto)',
          gridAutoFlow: 'column',
        };

  const grid = (
    <div className={`panel-viz panel-viz--${displayOrientation}`} style={gridStyle}>
      {cells.map((cell) => {
        if (cell.kind === 'hidden') {
          // Rendered by its parent double-pole breaker — skip.
          return null;
        }
        if (cell.kind === 'empty') {
          return (
            <button
              key={cell.n}
              type="button"
              className="panel-viz__slot panel-viz__slot--empty"
              onClick={() => onSlotClick?.(cell.n, null)}
              aria-label={`Slot ${cell.n}: spare`}
            >
              <span className="panel-viz__slot-n">{cell.n}</span>
              <span className="panel-viz__slot-label">— spare —</span>
            </button>
          );
        }
        if (cell.kind === 'tandem') {
          // G34: render tandem slot as a single container with two stacked
          // sub-cells (top = half a, bottom = half b). Each sub-cell is its
          // own focusable button so the user can tap each circuit
          // independently — but they share a slot number.
          return (
            <div
              key={cell.n}
              className="panel-viz__slot panel-viz__slot--tandem-pair"
              role="group"
              aria-label={`Slot ${cell.n} (tandem)`}
            >
              {(['a', 'b'] as const).map((half) => {
                const b = half === 'a' ? cell.halfA : cell.halfB;
                if (b === null) {
                  return (
                    <button
                      key={half}
                      type="button"
                      className={
                        'panel-viz__slot panel-viz__slot--empty panel-viz__slot--tandem-half'
                      }
                      // G34 fixup: pass the half hint so the parent can pre-
                      // fill the form with poles=tandem + this half.
                      onClick={() => onSlotClick?.(cell.n, null, half)}
                      aria-label={`Slot ${cell.n}${half}: spare (tandem half ${half})`}
                      data-tandem-half={half}
                    >
                      <span className="panel-viz__slot-n">
                        {cell.n}
                        {half}
                      </span>
                      <span className="panel-viz__slot-label">— spare —</span>
                    </button>
                  );
                }
                const subTandem =
                  subpanelsByFeederBreakerId?.get(b.id) ?? null;
                return (
                  <button
                    key={half}
                    type="button"
                    id={`slot-cell-${b.id}`}
                    data-testid="slot-cell"
                    data-breaker-id={b.id}
                    data-tandem-half={half}
                    className={
                      'panel-viz__slot panel-viz__slot--breaker panel-viz__slot--tandem-half' +
                      (highlightedBreakerId === b.id
                        ? ' panel-viz__slot--active'
                        : '')
                    }
                    onClick={() => onSlotClick?.(cell.n, b)}
                    aria-label={`Slot ${cell.n}${half}: ${b.label}, ${b.amperage} amp tandem (half ${half})`}
                  >
                    <span className="panel-viz__slot-n">
                      {cell.n}
                      {half}
                    </span>
                    <span className="panel-viz__slot-amp">{b.amperage}A</span>
                    <span className="panel-viz__slot-label" title={b.label}>
                      {b.label}
                    </span>
                    {b.protection !== null && (
                      <ProtectionBadge kind={b.protection} />
                    )}
                    <LoadChip load={loadByBreakerId?.get(b.id)} />
                    {subTandem && (
                      <SubpanelBadge subpanel={subTandem} navigate={setLocation} />
                    )}
                  </button>
                );
              })}
            </div>
          );
        }
        const b = cell.breaker;
        const isTandem = b.poles === 'tandem';
        const spanStyle: CSSProperties =
          cell.span === 2
            ? displayOrientation === 'vertical'
              ? { gridRow: 'span 2' }
              : { gridColumn: 'span 2' }
            : {};
        const cls =
          'panel-viz__slot panel-viz__slot--breaker' +
          (cell.span === 2 ? ' panel-viz__slot--double' : '') +
          (isTandem ? ' panel-viz__slot--tandem' : '') +
          (highlightedBreakerId === b.id ? ' panel-viz__slot--active' : '');
        const sub = subpanelsByFeederBreakerId?.get(b.id) ?? null;
        return (
          <button
            key={cell.n}
            type="button"
            id={`slot-cell-${b.id}`}
            data-testid="slot-cell"
            data-breaker-id={b.id}
            className={cls}
            style={spanStyle}
            onClick={() => onSlotClick?.(cell.n, b)}
            aria-label={`Slot ${cell.n}: ${b.label}, ${b.amperage} amp ${b.poles}-pole`}
          >
            <span className="panel-viz__slot-n">
              {cell.n}
              {cell.span === 2 ? `–${cell.n + 1}` : ''}
            </span>
            <span className="panel-viz__slot-amp">{b.amperage}A</span>
            <span className="panel-viz__slot-label" title={b.label}>
              {b.label}
            </span>
            {b.protection !== null && <ProtectionBadge kind={b.protection} />}
            <LoadChip load={loadByBreakerId?.get(b.id)} />
            {sub && <SubpanelBadge subpanel={sub} navigate={setLocation} />}
          </button>
        );
      })}
    </div>
  );

  // G25 cycle-24 — horizontal-mode panels with many slots overflow the
  // mobile viewport. Wrap in a scroller so the grid retains slot widths
  // and the user pans laterally instead of seeing clipped slots.
  // G29 cycle-36 — only wrap when DISPLAY orientation is horizontal. On
  // narrow viewports we force vertical (above), so the scroller wrapper
  // would just add wasted horizontal padding for nothing.
  if (displayOrientation === 'horizontal') {
    return <div className="panel-viz--horizontal-scroll">{grid}</div>;
  }
  return grid;
};
