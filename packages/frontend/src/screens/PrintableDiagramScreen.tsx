import { useCallback, useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import type { Breaker, Panel, ResolvedComponent } from '@he/shared';
import { getPanel, listBreakers, listComponents } from '../api.js';
import { formatDate } from '../lib/datetime.js';
import { PrintablePanelDiagram } from '../components/PrintablePanelDiagram.js';
import { Qr } from '../ui/qr.js';

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
 *
 * G41 cycle — the slot grid is now the shared `<PrintablePanelDiagram>`
 * component (reused by the building-scoped /buildings/:id/print bundle).
 * This screen keeps its panel-specific QR header + scan index; the grid
 * markup is byte-identical to the pre-G41 inline version.
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

  const printedOn = formatDate(Date.now(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // G44 — deep-link URLs built from window.location.origin AT RENDER TIME (the
  // verbatim G44-pinned contract; not configurable this cycle). Defensive empty
  // fallback for non-browser/empty origin — in practice always present here.
  //
  // AUTH DEGRADATION (PIN 5 — documented, NOT solved): the realistic scan
  // device is the owner's already-logged-in phone (30-day he_auth cookie). On
  // that path the authed cold-load works — App.tsx mounts the route Switch once
  // phase==='authed', and the PanelDetailScreen hash consumer fires on initial
  // mount AND on hashchange, so #breaker-<id> pulses the slot. An
  // UNAUTHENTICATED scan instead lands on the login screen and the hash is lost
  // — deep-link-through-login is an out-of-scope future enhancement, not G44.
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : '';
  const panelUrl = `${origin}/panels/${panelId}`;
  const breakerUrl = (breakerId: string): string =>
    `${origin}/panels/${panelId}#breaker-${breakerId}`;

  // The QR scan-index iterates the SAME set the slot grid renders: every
  // breaker with a non-null slotPosition (this includes BOTH tandem halves —
  // each half is its own breaker row with its own id — and the double-pole
  // breaker, which has a single id). Order matches the slot grid: by slot
  // position, then tandem half within a slot.
  const indexBreakers = breakers
    .filter((b) => b.slotPosition !== null)
    .slice()
    .sort((a, b) => {
      const sa = a.slotPosition ?? 0;
      const sb = b.slotPosition ?? 0;
      if (sa !== sb) return sa - sb;
      return (a.tandemHalf ?? '').localeCompare(b.tandemHalf ?? '');
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
        {/* G44 — panel-level QR (larger). Encodes the panel URL; the visible
            origin text below makes a stale/wrong-origin printed label
            human-diagnosable (Lock-in mitigation). */}
        <div className="printable-page__qr" data-testid="printable-panel-qr">
          <Qr value={panelUrl} size={96} />
          <span className="printable-scan-index__origin">{origin}</span>
        </div>
        <div className="printable-page__meta">
          <span>Printed {printedOn}</span>
        </div>
      </header>

      <PrintablePanelDiagram
        panel={panel}
        breakers={breakers}
        components={panelComponents}
      />

      {/* G44 — Scan index. One deep-link QR per occupied breaker, in its own
          section so the compact slot grid above is untouched. May flow onto a
          page 2 (each item is break-inside: avoid). */}
      {indexBreakers.length > 0 && (
        <section
          className="printable-scan-index"
          data-testid="printable-scan-index"
          aria-label="Breaker scan index"
        >
          <h2 className="printable-scan-index__heading">Scan index</h2>
          <p className="printable-scan-index__note">
            Scan a code with your phone to open this panel straight to that
            breaker. Origin: {origin}
          </p>
          <ol className="printable-scan-index__grid">
            {indexBreakers.map((b) => {
              const slotN = b.slotPosition ?? 0;
              const slotLabel = `Slot ${slotN}${b.tandemHalf ?? ''}`;
              return (
                <li
                  key={b.id}
                  className="printable-scan-index__item"
                  data-testid="printable-scan-index-item"
                  data-breaker-id={b.id}
                >
                  <Qr value={breakerUrl(b.id)} size={64} />
                  <span className="printable-scan-index__caption">
                    <span className="printable-scan-index__slot">
                      {slotLabel}
                    </span>
                    <span className="printable-scan-index__label">
                      {b.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <footer className="printable-page__footer">
        <span>Generated by House Electricals</span>
        <span>Tape inside the panel door for quick reference.</span>
      </footer>
    </div>
  );
};
