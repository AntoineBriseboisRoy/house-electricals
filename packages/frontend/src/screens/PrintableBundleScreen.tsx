import { useCallback, useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import type {
  Breaker,
  BuildingExportParsed,
  Component,
  Floor,
} from '@he/shared';

/** Panel as it appears in the export envelope (the base `panelSchema` shape —
 *  no `floorPlan` field, unlike the frontend `Panel` type). */
type ExportPanel = BuildingExportParsed['panels'][number];
import { getBuildingExport, floorPlanUrl } from '../api.js';
import { formatDate } from '../lib/datetime.js';
import { PrintablePanelDiagram } from '../components/PrintablePanelDiagram.js';
import { FloorPlanVectorOverlay } from '../ui/FloorPlanVectorOverlay.js';
import {
  ComponentTypeIcon,
  componentTypeLabel,
} from '../components/ComponentTypeIcon.js';

/**
 * G41 cycle — "Share with electrician" building PDF bundle.
 *
 * A building-scoped, multi-page printable artifact. The user opens this
 * route, hits Cmd/Ctrl+P (or "Save as PDF"), and shares the result with an
 * electrician (AirDrop / email / print) — no account, no upload, no link
 * expiry (single-user, building-scoped).
 *
 * Reuses the G24 (cycle-27) print contract verbatim:
 * - Mounted OUTSIDE AppShell via the App.tsx escape-hatch (no nav, no theme
 *   toggle, no app chrome).
 * - Black-on-white paper artifact regardless of theme — all colors are
 *   literal hex inside the `.printable-page` cascade (cycle-27 G24 ADR #4).
 * - @media print: letter @page, 0.5in margins, multi-page break rules so
 *   each major section starts cleanly.
 * - NO interactive elements — a static artifact.
 *
 * Sections (in order): cover + watermark · one panel slot-diagram per panel
 * (the shared `<PrintablePanelDiagram>`) · one floor plan per floor (vector
 * overlay + optional uploaded image + component pins) + per-room component
 * lists · the breaker→component circuit directory · footer watermark.
 *
 * Data: one authed fetch of the building's export.json tree (building,
 * floors, rooms, walls, panels, breakers, components) scoped to the route's
 * :id — independent of the active building context.
 */

const polesLabel = (p: Breaker['poles']): string =>
  p === 'single' ? '1-pole' : p === 'double' ? '2-pole' : 'tandem';

const slotLabel = (b: Breaker): string =>
  b.poles === 'tandem' && b.tandemHalf !== null
    ? `${b.slot}${b.tandemHalf}`
    : b.slot;

const WATERMARK = (date: string): string =>
  `Generated ${date}; verify before working live.`;

export const PrintableBundleScreen = (): JSX.Element => {
  const [, params] = useRoute<{ id: string }>('/buildings/:id/print');
  const buildingId = params?.id ?? '';

  const [data, setData] = useState<BuildingExportParsed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!buildingId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getBuildingExport(buildingId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load building.');
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="printable-page" data-testid="printable-bundle">
        <p>Loading building…</p>
      </div>
    );
  }
  if (error !== null || data === null) {
    return (
      <div className="printable-page" data-testid="printable-bundle">
        <p>{error ?? 'Building not found.'}</p>
      </div>
    );
  }

  const printedOn = formatDate(Date.now(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  // ISO date for the watermark note (the exact wording the VISION pins).
  const isoDate = new Date().toISOString().slice(0, 10);

  // Index the tree.
  const breakersByPanel = new Map<string, Breaker[]>();
  for (const b of data.breakers) {
    const arr = breakersByPanel.get(b.panelId);
    if (arr) arr.push(b);
    else breakersByPanel.set(b.panelId, [b]);
  }
  const componentsByBreaker = new Map<string, Component[]>();
  const componentsByFloor = new Map<string, Component[]>();
  for (const c of data.components) {
    if (c.breakerId !== null) {
      const arr = componentsByBreaker.get(c.breakerId);
      if (arr) arr.push(c);
      else componentsByBreaker.set(c.breakerId, [c]);
    }
    if (c.floorId !== null) {
      const arr = componentsByFloor.get(c.floorId);
      if (arr) arr.push(c);
      else componentsByFloor.set(c.floorId, [c]);
    }
  }
  const panelName = new Map(data.panels.map((p) => [p.id, p.name]));
  const wallsByFloor = new Map<string, typeof data.walls>();
  for (const w of data.walls) {
    const arr = wallsByFloor.get(w.floorId);
    if (arr) arr.push(w);
    else wallsByFloor.set(w.floorId, [w]);
  }
  const roomsByFloor = new Map<string, typeof data.rooms>();
  for (const r of data.rooms) {
    const arr = roomsByFloor.get(r.floorId);
    if (arr) arr.push(r);
    else roomsByFloor.set(r.floorId, [r]);
  }

  // Components wired to ANY breaker of a given panel — fed to the shared
  // <PrintablePanelDiagram>.
  const panelComponents = (panel: ExportPanel): Component[] => {
    const ids = new Set((breakersByPanel.get(panel.id) ?? []).map((b) => b.id));
    return data.components.filter(
      (c) => c.breakerId !== null && ids.has(c.breakerId)
    );
  };

  const panelsInOrder = [...data.panels].sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const floorsInOrder = [...data.floors].sort(
    (a, b) => a.createdAt - b.createdAt
  );

  // Circuit directory rows: panels in creation order; breakers by slot.
  const panelOrder = new Map(data.panels.map((p, i) => [p.id, i]));
  const directoryBreakers = [...data.breakers].sort((a, b) => {
    const pa = panelOrder.get(a.panelId) ?? 0;
    const pb = panelOrder.get(b.panelId) ?? 0;
    if (pa !== pb) return pa - pb;
    const sa = a.slotPosition ?? Number.MAX_SAFE_INTEGER;
    const sb = b.slotPosition ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.slot.localeCompare(b.slot);
  });

  const renderFloorPlan = (floor: Floor): JSX.Element => {
    const walls = wallsByFloor.get(floor.id) ?? [];
    const rooms = roomsByFloor.get(floor.id) ?? [];
    const placed = (componentsByFloor.get(floor.id) ?? []).filter(
      (c) => c.posX !== null && c.posY !== null
    );
    // Floor.floorPlan is { width, height, filename } | null. Coords are
    // normalized 0-10000 relative to the image's natural size (or the 1:1
    // vector canvas when no image). Pins position as posX/posY ÷ 100 = %.
    const plan = floor.floorPlan;
    return (
      <div
        className="printable-floor__canvas floor-plan"
        data-testid="printable-floor-canvas"
        style={
          plan !== null
            ? { aspectRatio: `${plan.width} / ${plan.height}` }
            : undefined
        }
      >
        {plan !== null && (
          <img
            className="floor-plan__img"
            src={floorPlanUrl(plan.filename)}
            alt={floor.name}
            draggable={false}
          />
        )}
        <FloorPlanVectorOverlay walls={walls} rooms={rooms} />
        {placed.map((c) => (
          <span
            key={c.id}
            className="printable-floor__pin"
            data-testid="printable-floor-pin"
            data-component-id={c.id}
            style={{
              left: `${(c.posX ?? 0) / 100}%`,
              top: `${(c.posY ?? 0) / 100}%`,
            }}
          >
            <span className="printable-floor__pin-icon" aria-hidden="true">
              <ComponentTypeIcon type={c.type} size={12} />
            </span>
            <span className="printable-floor__pin-name">{c.name}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="printable-page printable-bundle" data-testid="printable-bundle">
      {/* ---- Cover ---- */}
      <header className="printable-page__header">
        <div>
          <h1 className="printable-page__title">{data.building.name}</h1>
          <p className="printable-page__subtitle">
            Electrical reference for your electrician ·{' '}
            {data.panels.length} panel{data.panels.length === 1 ? '' : 's'} ·{' '}
            {data.floors.length} floor{data.floors.length === 1 ? '' : 's'} ·{' '}
            {data.components.length} component
            {data.components.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="printable-page__meta">
          <span>Printed {printedOn}</span>
        </div>
      </header>

      <p
        className="printable-bundle__watermark"
        data-testid="printable-bundle-watermark"
      >
        {WATERMARK(isoDate)}
      </p>

      {/* ---- Panel diagrams ---- */}
      {panelsInOrder.length > 0 && (
        <section
          className="printable-bundle__section"
          data-testid="printable-bundle-panels"
          aria-label="Panel diagrams"
        >
          {panelsInOrder.map((panel) => (
            <div
              key={panel.id}
              className="printable-bundle__panel"
              data-testid="printable-bundle-panel"
              data-panel-id={panel.id}
            >
              <h2 className="printable-bundle__heading">{panel.name}</h2>
              <p className="printable-bundle__heading-sub">
                {panel.slotCount}-slot panel
              </p>
              <PrintablePanelDiagram
                panel={panel}
                breakers={breakersByPanel.get(panel.id) ?? []}
                components={panelComponents(panel)}
              />
            </div>
          ))}
        </section>
      )}

      {/* ---- Floor plans + per-room component lists ---- */}
      {floorsInOrder.length > 0 && (
        <section
          className="printable-bundle__section"
          data-testid="printable-bundle-floors"
          aria-label="Floor plans"
        >
          {floorsInOrder.map((floor) => {
            const rooms = (roomsByFloor.get(floor.id) ?? [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name));
            const onFloor = componentsByFloor.get(floor.id) ?? [];
            // Group floor components by room name; null room → "Unassigned".
            const byRoom = new Map<string, Component[]>();
            for (const c of onFloor) {
              const key = c.room ?? '— No room —';
              const arr = byRoom.get(key);
              if (arr) arr.push(c);
              else byRoom.set(key, [c]);
            }
            // Render rooms in name order, then any leftover room groups
            // (e.g. names not matching a drawn room, or "No room").
            const roomNames = rooms.map((r) => r.name);
            const extraKeys = [...byRoom.keys()].filter(
              (k) => !roomNames.includes(k)
            );
            const orderedRoomKeys = [...roomNames, ...extraKeys].filter(
              (k, i, arr) => arr.indexOf(k) === i
            );
            return (
              <div
                key={floor.id}
                className="printable-bundle__floor"
                data-testid="printable-bundle-floor"
                data-floor-id={floor.id}
              >
                <h2 className="printable-bundle__heading">{floor.name}</h2>
                {renderFloorPlan(floor)}
                <div className="printable-bundle__rooms">
                  {orderedRoomKeys.length === 0 ? (
                    <p className="printable-bundle__empty">
                      No components placed on this floor.
                    </p>
                  ) : (
                    orderedRoomKeys.map((roomKey) => {
                      const comps = (byRoom.get(roomKey) ?? [])
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name));
                      if (comps.length === 0) return null;
                      return (
                        <div
                          key={roomKey}
                          className="printable-bundle__room"
                          data-testid="printable-bundle-room"
                        >
                          <h3 className="printable-bundle__room-name">
                            {roomKey}
                          </h3>
                          <ul className="printable-bundle__room-list">
                            {comps.map((c) => (
                              <li key={c.id}>
                                <span
                                  className="printable-slot__component-icon"
                                  aria-hidden="true"
                                >
                                  <ComponentTypeIcon type={c.type} />
                                </span>
                                <span className="printable-slot__component-name">
                                  {c.name}
                                </span>
                                <span className="printable-slot__component-type">
                                  ({componentTypeLabel(c.type)})
                                </span>
                                {c.breakerId !== null && (
                                  <span className="printable-bundle__room-circuit">
                                    {(() => {
                                      const b = data.breakers.find(
                                        (br) => br.id === c.breakerId
                                      );
                                      if (b === undefined) return null;
                                      return `· ${panelName.get(b.panelId) ?? ''} ${slotLabel(b)}`;
                                    })()}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ---- Circuit directory (breaker → component map) ---- */}
      <section
        className="printable-bundle__section"
        data-testid="printable-bundle-directory"
        aria-label="Circuit directory"
      >
        <h2 className="printable-bundle__heading">Circuit directory</h2>
        <p className="printable-bundle__heading-sub">
          Every breaker and the components it powers.
        </p>
        <table className="printable-bundle__table">
          <thead>
            <tr>
              <th>Panel</th>
              <th>Slot</th>
              <th>Amp</th>
              <th>Poles</th>
              <th>Breaker</th>
              <th>Protection</th>
              <th>Components</th>
            </tr>
          </thead>
          <tbody>
            {directoryBreakers.map((b) => {
              const wired = (componentsByBreaker.get(b.id) ?? [])
                .slice()
                .sort((x, y) => x.name.localeCompare(y.name));
              return (
                <tr key={b.id} data-testid="printable-bundle-directory-row">
                  <td>{panelName.get(b.panelId) ?? ''}</td>
                  <td>{slotLabel(b)}</td>
                  <td>{b.amperage}A</td>
                  <td>{polesLabel(b.poles)}</td>
                  <td>{b.label}</td>
                  <td>
                    {b.protection !== null
                      ? b.protection === 'dual'
                        ? 'DUAL'
                        : b.protection.toUpperCase()
                      : ''}
                  </td>
                  <td>
                    {wired.length === 0
                      ? '—'
                      : wired
                          .map(
                            (c) =>
                              `${c.name}${c.room !== null ? ` (${c.room})` : ''}`
                          )
                          .join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <footer className="printable-page__footer">
        <span>Generated by House Electricals</span>
        <span>{WATERMARK(isoDate)}</span>
      </footer>
    </div>
  );
};
