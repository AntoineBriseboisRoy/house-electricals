import { useCallback, useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import type {
  Breaker,
  Panel,
  ProtectionKind,
  ResolvedComponent,
} from '@he/shared';
import { getPanel, listBreakers, listComponents } from '../api.js';
import { formatDate } from '../lib/datetime.js';
import { ComponentTypeIcon, componentTypeLabel } from '../components/ComponentTypeIcon.js';

/** G37 Part 2 cycle-69 — print-styled protection chip. Monochrome
 *  black-on-white (no --color-warning* tokens — those are screen amber
 *  per cycle-27 G24 ADR #4: the print view always renders the same
 *  artifact regardless of theme). Label matches the cycle-68
 *  ProtectionBadge (GFCI / AFCI / DUAL) so the paper reference reads
 *  consistently with the on-screen badge. */
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

/**
 * G24 cycle-27 — printable breaker diagram.
 *
 * Letter-paper-sized panel reference. User opens this route, hits
 * Cmd/Ctrl+P, prints the page, tapes the result inside their electrical
 * panel door as a permanent paper reference.
 *
 * Design pins:
 * - Mounted OUTSIDE AppShell via the App.tsx escape-hatch (no bottom nav,
 *   no theme toggle, no app chrome at all).
 * - @media print rules force black-on-white, letter @page size, 0.5in
 *   margins. See styles.css `.printable-page` block.
 * - The page also renders as a paper-like white card on screen (against
 *   the dark canvas) so 'Print to PDF' from the browser produces an
 *   attractive PDF without invoking the actual printer.
 * - NO interactive elements — this is a static artifact.
 */
export const PrintableDiagramScreen = (): JSX.Element => {
  const [, params] = useRoute<{ id: string }>('/panels/:id/print');
  const panelId = params?.id ?? '';

  const [panel, setPanel] = useState<Panel | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [panelComponents, setPanelComponents] = useState<ResolvedComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!panelId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, b, allComponents] = await Promise.all([
        getPanel(panelId),
        listBreakers(panelId),
        listComponents(),
      ]);
      setPanel(p);
      setBreakers(b);
      const breakerIdSet = new Set(b.map((br) => br.id));
      setPanelComponents(
        allComponents.filter(
          (c) => c.breakerId !== null && breakerIdSet.has(c.breakerId)
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load panel.');
    } finally {
      setLoading(false);
    }
  }, [panelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="printable-page" data-testid="printable-page">
        <p>Loading panel…</p>
      </div>
    );
  }
  if (error !== null || panel === null) {
    return (
      <div className="printable-page" data-testid="printable-page">
        <p>{error ?? 'Panel not found.'}</p>
      </div>
    );
  }

  // Build a slot index → breaker(s) map. For orientations the printed layout
  // is always 2-column vertical (matches a real residential panel), even if
  // the screen viz uses horizontal. This keeps the printed artifact stable.
  //
  // Cycle-65 P1 — a tandem slot legally holds TWO breakers (halves 'a' + 'b';
  // see cycle-42 G34 ADR rules 5+6). Previously this map clobbered, dropping
  // one half from the printed reference. Now we collect both halves per slot.
  const byPosition = new Map<number, Breaker[]>();
  for (const b of breakers) {
    if (b.slotPosition === null) continue;
    const arr = byPosition.get(b.slotPosition);
    if (arr) arr.push(b);
    else byPosition.set(b.slotPosition, [b]);
  }
  // Stable tandem ordering: half 'a' before half 'b' within a slot.
  for (const arr of byPosition.values()) {
    arr.sort((a, b) => {
      const ah = a.tandemHalf ?? '';
      const bh = b.tandemHalf ?? '';
      return ah.localeCompare(bh);
    });
  }

  // Renders the components under a breaker. Returns null when there are none
  // so the slot stays compact on paper.
  //
  // G37 Part 2 cycle-69 — a component carrying its OWN protection (e.g.
  // GFCI receptacle on a non-GFCI breaker) renders the chip inline next
  // to its name. Per cycle-68 G37 ADR #2, this is INDEPENDENT of the
  // breaker's own protection: both chips can render if both fields are
  // set (older home with GFCI breaker + GFCI outlet downstream).
  const renderComponents = (breakerId: string): JSX.Element | null => {
    const comps = panelComponents.filter((c) => c.breakerId === breakerId);
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

  /** Cycle-65 P1 — render a single breaker's header + components, used both
   *  for non-tandem (single occupant) and tandem (two stacked occupants in
   *  one slot cell) flows.
   *
   *  G37 Part 2 cycle-69 — a protection-marked breaker renders the chip
   *  inline in the header. Independent of any wired component's
   *  protection per cycle-68 G37 ADR #2 (the two capture distinct
   *  real-world setups). */
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
        // Cycle-65 P1 — render BOTH halves in one slot cell, stacked. The
        // outer .printable-slot still represents slot N visually; inside,
        // each half gets its own header + components list separated by a
        // divider line.
        slots.push(
          <li
            key={n}
            className="printable-slot printable-slot--tandem"
          >
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
              'printable-slot' +
              (isDouble ? ' printable-slot--double' : '')
            }
          >
            {renderBreakerBody(first, n)}
          </li>
        );
        if (isDouble && n + 1 <= panel.slotCount) n++; // skip the merged slot
      }
    } else {
      slots.push(
        <li key={n} className="printable-slot printable-slot--empty">
          <div className="printable-slot__header">
            <span className="printable-slot__n">{n}</span>
            <span className="printable-slot__amp printable-slot__amp--spare">— spare —</span>
          </div>
        </li>
      );
    }
  }

  const printedOn = formatDate(Date.now(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="printable-page" data-testid="printable-page">
      <header className="printable-page__header">
        <div>
          <h1 className="printable-page__title">{panel.name}</h1>
          <p className="printable-page__subtitle">
            Electrical breaker reference · {panel.slotCount}-slot panel
          </p>
        </div>
        <div className="printable-page__meta">
          <span>Printed {printedOn}</span>
        </div>
      </header>

      <ol className="printable-slots" aria-label="Breaker slots">
        {slots}
      </ol>

      <footer className="printable-page__footer">
        <span>Generated by House Electricals</span>
        <span>Tape inside the panel door for quick reference.</span>
      </footer>
    </div>
  );
};
