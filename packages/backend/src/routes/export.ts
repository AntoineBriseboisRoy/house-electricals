import { Hono } from 'hono';
import type {
  ApiError,
  Breaker,
  BreakerRepository,
  BreakerTest,
  Building,
  BuildingRepository,
  Component,
  ComponentRepository,
  Floor,
  FloorRepository,
  Panel,
  PanelRepository,
  Room,
  RoomRepository,
  ServiceEntry,
  ServiceEntryParentType,
  SwitchControl,
  Wall,
  WallRepository,
} from '@he/shared';
import type { Db } from '../db.js';

/**
 * Building export (2026-05). Two read-only, building-scoped endpoints:
 *
 *  - GET /api/v1/buildings/:id/export.json — the building's FULL tree
 *    (building, floors, rooms, walls, panels, breakers, components,
 *    switch_controls, service_entries, breaker_tests) as a JSON download.
 *  - GET /api/v1/buildings/:id/export.csv — a flat "circuit directory"
 *    (panel → breaker slot/amperage/label → each wired component).
 *
 * The main entities go through their repositories (clean camelCase objects).
 * switch_controls / breaker_tests / service_entries have no per-building repo
 * accessor, so they're read via `db` with a building-scoped subquery — this is
 * a read-only reporting aggregation (same precedent as the flat switch-controls
 * route), NOT a write path bypassing the Repository contract.
 */

type ExportDeps = {
  db: Db;
  buildingRepository: BuildingRepository;
  panelRepository: PanelRepository;
  breakerRepository: BreakerRepository;
  floorRepository: FloorRepository;
  roomRepository: RoomRepository;
  wallRepository: WallRepository;
  componentRepository: ComponentRepository;
};

export type BuildingExport = {
  format: 'house-electricals-building-export';
  version: 1;
  exportedAt: number;
  building: Building;
  floors: Floor[];
  rooms: Room[];
  walls: Wall[];
  panels: Panel[];
  breakers: Breaker[];
  components: Component[];
  switchControls: SwitchControl[];
  serviceEntries: ServiceEntry[];
  breakerTests: BreakerTest[];
};

/** Gather the whole building tree, or null when the building doesn't exist. */
const gather = async (
  deps: ExportDeps,
  buildingId: string,
  exportedAt: number
): Promise<BuildingExport | null> => {
  const building = await deps.buildingRepository.get(buildingId);
  if (building === null) return null;

  const filter = { buildingId };
  const [panels, floors, resolvedComponents] = await Promise.all([
    deps.panelRepository.list(filter),
    deps.floorRepository.list(filter),
    deps.componentRepository.list(filter),
  ]);

  // Strip the resolved `breaker` summary — it's redundant with `breakers`.
  const components: Component[] = resolvedComponents.map(
    ({ breaker: _breaker, ...rest }) => rest
  );

  const breakers: Breaker[] = (
    await Promise.all(panels.map((p) => deps.breakerRepository.listByPanel(p.id)))
  ).flat();

  const [roomsNested, wallsNested] = await Promise.all([
    Promise.all(floors.map((f) => deps.roomRepository.listByFloor(f.id))),
    Promise.all(floors.map((f) => deps.wallRepository.listByFloor(f.id))),
  ]);
  const rooms = roomsNested.flat();
  const walls = wallsNested.flat();

  // Polymorphic / join tables — building-scoped subqueries.
  const scRows = await deps.db.query<{
    switch_id: string;
    gang_index: number;
    controlled_id: string;
  }>(
    `SELECT sc.switch_id, sc.gang_index, sc.controlled_id
       FROM switch_controls sc
       JOIN components c ON c.id = sc.switch_id
       WHERE c.building_id = $1
       ORDER BY sc.switch_id ASC, sc.gang_index ASC, sc.controlled_id ASC`,
    [buildingId]
  );
  const switchControls: SwitchControl[] = scRows.map((r) => ({
    switchId: r.switch_id,
    gangIndex: r.gang_index,
    controlledId: r.controlled_id,
  }));

  const btRows = await deps.db.query<{
    id: string;
    breaker_id: string;
    tested_at: number;
    outcome: string | null;
    notes: string | null;
    created_at: number;
  }>(
    `SELECT id, breaker_id, tested_at, outcome, notes, created_at
       FROM breaker_tests
       WHERE breaker_id IN (
         SELECT b.id FROM breakers b JOIN panels p ON b.panel_id = p.id
         WHERE p.building_id = $1)
       ORDER BY tested_at DESC, id DESC`,
    [buildingId]
  );
  const breakerTests: BreakerTest[] = btRows.map((r) => ({
    id: r.id,
    breakerId: r.breaker_id,
    testedAt: r.tested_at,
    outcome: r.outcome,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  const seRows = await deps.db.query<{
    id: string;
    parent_type: ServiceEntryParentType;
    parent_id: string;
    occurred_at: number;
    note: string;
    created_at: number;
  }>(
    `SELECT id, parent_type, parent_id, occurred_at, note, created_at
       FROM service_entries
       WHERE (parent_type = 'breaker' AND parent_id IN (
                SELECT b.id FROM breakers b JOIN panels p ON b.panel_id = p.id
                WHERE p.building_id = $1))
          OR (parent_type = 'component' AND parent_id IN (
                SELECT id FROM components WHERE building_id = $1))
       ORDER BY occurred_at DESC, id DESC`,
    [buildingId]
  );
  const serviceEntries: ServiceEntry[] = seRows.map((r) => ({
    id: r.id,
    parentType: r.parent_type,
    parentId: r.parent_id,
    occurredAt: r.occurred_at,
    note: r.note,
    createdAt: r.created_at,
  }));

  return {
    format: 'house-electricals-building-export',
    version: 1,
    exportedAt,
    building,
    floors,
    rooms,
    walls,
    panels,
    breakers,
    components,
    switchControls,
    serviceEntries,
    breakerTests,
  };
};

/** A filename-safe slug of the building name (falls back to its id). */
const safeName = (name: string, id: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug.length > 0 ? slug : id;
};

const csvCell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const polesLabel = (p: Breaker['poles']): string =>
  p === 'single' ? '1-pole' : p === 'double' ? '2-pole' : 'tandem';

/** Build the "circuit directory" CSV: one row per (breaker, wired component);
 *  breakers with no components get a single row with empty component cells. */
const toCsv = (data: BuildingExport): string => {
  const panelName = new Map(data.panels.map((p) => [p.id, p.name]));
  const componentsByBreaker = new Map<string, Component[]>();
  for (const c of data.components) {
    if (c.breakerId === null) continue;
    const arr = componentsByBreaker.get(c.breakerId);
    if (arr) arr.push(c);
    else componentsByBreaker.set(c.breakerId, [c]);
  }

  // Panels in creation order; breakers by slot position then slot label.
  const panelOrder = new Map(data.panels.map((p, i) => [p.id, i]));
  const breakers = [...data.breakers].sort((a, b) => {
    const pa = panelOrder.get(a.panelId) ?? 0;
    const pb = panelOrder.get(b.panelId) ?? 0;
    if (pa !== pb) return pa - pb;
    const sa = a.slotPosition ?? Number.MAX_SAFE_INTEGER;
    const sb = b.slotPosition ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.slot.localeCompare(b.slot);
  });

  const header = [
    'Panel',
    'Slot',
    'Amperage',
    'Poles',
    'Breaker Label',
    'Protection',
    'Component',
    'Type',
    'Room',
    'Load (W)',
  ];
  const rows: string[] = [header.map(csvCell).join(',')];

  for (const b of breakers) {
    const slot =
      b.poles === 'tandem' && b.tandemHalf !== null
        ? `${b.slot}${b.tandemHalf}`
        : b.slot;
    const base = [
      panelName.get(b.panelId) ?? '',
      slot,
      b.amperage,
      polesLabel(b.poles),
      b.label,
      b.protection ?? '',
    ];
    const wired = (componentsByBreaker.get(b.id) ?? []).sort((x, y) =>
      x.name.localeCompare(y.name)
    );
    if (wired.length === 0) {
      rows.push([...base, '', '', '', ''].map(csvCell).join(','));
    } else {
      for (const c of wired) {
        rows.push(
          [
            ...base,
            c.name,
            c.type,
            c.room ?? '',
            c.loadWatts ?? '',
          ].map(csvCell).join(',')
        );
      }
    }
  }
  // CRLF line endings — friendliest for spreadsheet apps (Excel).
  return rows.join('\r\n') + '\r\n';
};

export const buildExportRoutes = (deps: ExportDeps): Hono => {
  const router = new Hono();

  // Stamp exportedAt once per request (Date.now() is fine in a request
  // handler — the workflow-only restriction doesn't apply here).
  router.get('/buildings/:id/export.json', async (c) => {
    const id = c.req.param('id');
    const data = await gather(deps, id, Date.now());
    if (data === null) {
      const err: ApiError = { error: { message: 'Building not found.' } };
      return c.json(err, 404);
    }
    const file = `${safeName(data.building.name, data.building.id)}-export.json`;
    return c.body(JSON.stringify(data, null, 2), 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${file}"`,
    });
  });

  router.get('/buildings/:id/export.csv', async (c) => {
    const id = c.req.param('id');
    const data = await gather(deps, id, Date.now());
    if (data === null) {
      const err: ApiError = { error: { message: 'Building not found.' } };
      return c.json(err, 404);
    }
    const file = `${safeName(data.building.name, data.building.id)}-circuits.csv`;
    return c.body(toCsv(data), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${file}"`,
    });
  });

  return router;
};
