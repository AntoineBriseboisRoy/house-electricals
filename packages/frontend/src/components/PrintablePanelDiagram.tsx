import type { Breaker, Component, ProtectionKind } from '@he/shared';
import { ComponentTypeIcon, componentTypeLabel } from './ComponentTypeIcon.js';

/**
 * G41 cycle — shared printable panel slot-grid.
 *
 * Extracted from `PrintableDiagramScreen` (G24 cycle-27) so BOTH the
 * per-panel print artifact (`/panels/:id/print`) AND the building-scoped
 * "Share with electrician" bundle (`/buildings/:id/print`) render the SAME
 * slot diagram. The per-panel screen keeps its own QR header + scan index;
 * the bundle just stacks one of these per panel.
 *
 * Design pins (inherited from the G24 ADR — do NOT change):
 * - Black-on-white paper artifact. ALL colors are literal hex inside the
 *   `.printable-page` cascade (no design tokens — cycle-27 G24 ADR #4).
 * - Slots always render in a 2-column grid regardless of `panel.orientation`
 *   (matches a real residential panel door).
 * - A tandem slot legally holds TWO breakers ('a' + 'b'); both halves render
 *   stacked in one cell (cycle-65 P1 / cycle-42 G34 rules 5+6).
 * - Double-pole breakers span two slot positions; the merged slot is hidden.
 */

/** G37 Part 2 cycle-69 — monochrome protection chip (no --color-warning*
 *  tokens; the print view is always black-on-white). */
const protectionChipLabel = (kind: ProtectionKind): string =>
  kind === 'dual' ? 'DUAL' : kind.toUpperCase();

const PrintableProtectionChip = ({
  kind,
}: {
  kind: ProtectionKind;
}): JSX.Element => (
  <span
    className="printable-slot__protection-chip"
    data-testid="printable-protection-chip"
    data-protection={kind}
  >
    {protectionChipLabel(kind)}
  </span>
);

export type PrintablePanelDiagramProps = {
  /** Only `name` + `slotCount` are read; narrowed so BOTH the frontend `Panel`
   *  type (PrintableDiagramScreen, has `floorPlan`) AND the export-envelope
   *  panel shape (PrintableBundleScreen, no `floorPlan`) satisfy the prop. */
  panel: { name: string; slotCount: number };
  breakers: Breaker[];
  /** Components wired to ANY of this panel's breakers (caller pre-filters). */
  components: Pick<
    Component,
    'id' | 'name' | 'type' | 'room' | 'protection' | 'breakerId'
  >[];
};

export const PrintablePanelDiagram = ({
  panel,
  breakers,
  components,
}: PrintablePanelDiagramProps): JSX.Element => {
  // Build a slot index → breaker(s) map. Both tandem halves collected per slot.
  const byPosition = new Map<number, Breaker[]>();
  for (const b of breakers) {
    if (b.slotPosition === null) continue;
    const arr = byPosition.get(b.slotPosition);
    if (arr) arr.push(b);
    else byPosition.set(b.slotPosition, [b]);
  }
  // Stable tandem ordering: half 'a' before half 'b' within a slot.
  for (const arr of byPosition.values()) {
    arr.sort((a, b) =>
      (a.tandemHalf ?? '').localeCompare(b.tandemHalf ?? '')
    );
  }

  const renderComponents = (breakerId: string): JSX.Element | null => {
    const comps = components.filter((c) => c.breakerId === breakerId);
    if (comps.length === 0) return null;
    return (
      <ul className="printable-slot__components">
        {comps.map((c) => (
          <li key={c.id}>
            <span className="printable-slot__component-icon" aria-hidden="true">
              <ComponentTypeIcon type={c.type} />
            </span>
            <span className="printable-slot__component-name">{c.name}</span>
            {c.protection !== null && (
              <PrintableProtectionChip kind={c.protection} />
            )}
            {c.room !== null && (
              <span className="printable-slot__component-room">· {c.room}</span>
            )}
            <span className="printable-slot__component-type">
              ({componentTypeLabel(c.type)})
            </span>
          </li>
        ))}
      </ul>
    );
  };

  const renderBreakerBody = (b: Breaker, slotN: number): JSX.Element => {
    const isDouble = b.poles === 'double';
    const isTandem = b.poles === 'tandem';
    const half = b.tandemHalf ?? '';
    return (
      <>
        <div className="printable-slot__header">
          <span className="printable-slot__n">
            {slotN}
            {isDouble && slotN + 1 <= panel.slotCount ? `–${slotN + 1}` : ''}
            {isTandem && half ? half : ''}
          </span>
          <span className="printable-slot__amp">
            {b.amperage}A {isDouble ? '2P' : isTandem ? 'T' : '1P'}
          </span>
          <span className="printable-slot__label">{b.label}</span>
          {b.protection !== null && (
            <PrintableProtectionChip kind={b.protection} />
          )}
        </div>
        {renderComponents(b.id)}
      </>
    );
  };

  const slots: JSX.Element[] = [];
  for (let n = 1; n <= panel.slotCount; n++) {
    const occupants = byPosition.get(n);
    if (occupants !== undefined && occupants.length > 0) {
      const first = occupants[0];
      const isDouble = first.poles === 'double';
      const isTandem = first.poles === 'tandem';
      if (isTandem) {
        slots.push(
          <li key={n} className="printable-slot printable-slot--tandem">
            {occupants.map((b, i) => (
              <div
                key={b.id}
                className={
                  'printable-slot__tandem-half' +
                  (i > 0 ? ' printable-slot__tandem-half--second' : '')
                }
              >
                {renderBreakerBody(b, n)}
              </div>
            ))}
          </li>
        );
      } else {
        slots.push(
          <li
            key={n}
            className={
              'printable-slot' + (isDouble ? ' printable-slot--double' : '')
            }
          >
            {renderBreakerBody(first, n)}
          </li>
        );
        if (isDouble && n + 1 <= panel.slotCount) n++; // skip merged slot
      }
    } else {
      slots.push(
        <li key={n} className="printable-slot printable-slot--empty">
          <div className="printable-slot__header">
            <span className="printable-slot__n">{n}</span>
            <span className="printable-slot__amp printable-slot__amp--spare">
              — spare —
            </span>
          </div>
        </li>
      );
    }
  }

  return (
    <ol className="printable-slots" aria-label={`Breaker slots for ${panel.name}`}>
      {slots}
    </ol>
  );
};
