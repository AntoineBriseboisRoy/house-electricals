import { monotonicFactory } from 'ulid';
import { z } from 'zod';

const ulid = monotonicFactory();

// Re-export zod so backend and frontend never disagree on the version.
export { z } from 'zod';

export type FloorPlan = {
  filename: string;
  width: number;
  height: number;
};

/** Physical layout of a breaker panel for G18 visualization.
 *   - 'vertical' = the typical residential tall-narrow panel; slots laid
 *     out as a 2-column grid (1,2 / 3,4 / 5,6 / ...).
 *   - 'horizontal' = wide-short layout; slots laid out as a 2-row grid. */
export type PanelOrientation = 'vertical' | 'horizontal';

export type Panel = {
  id: string;
  name: string;
  createdAt: number;
  floorPlan: FloorPlan | null;
  /** G18: visualization layout. Default 'vertical'. */
  orientation: PanelOrientation;
  /** G18: total slot positions in the panel. Typical residential
   *  panels are 20, 24, 30, 40, or 42. Default 24. */
  slotCount: number;
  /** G39 cycle-56 — subpanel hierarchy. When set, this panel is "fed by"
   *  another panel's breaker (the typical garage/basement subpanel case).
   *  Top-level panels have parentBreakerId = null. FK is nullable with
   *  ON DELETE SET NULL — deleting the feeder breaker DETACHES the
   *  subpanel rather than cascading. See CLAUDE.md "Subpanel hierarchy
   *  (G39 — cycle-56)" for the contract. */
  parentBreakerId: string | null;
};

export type PanelUpdate = {
  name?: string;
  orientation?: PanelOrientation;
  slotCount?: number;
  /** G39 cycle-56 — set to a breaker id to wire this panel as that
   *  breaker's subpanel; set to null to detach. Undefined leaves it. */
  parentBreakerId?: string | null;
};

export type ApiEnvelope<T> = {
  data: T;
};

/**
 * Public runtime config exposed to the SPA (GET /api/v1/config). `tz` is the
 * operator-configured IANA timezone (the `TZ` env var) that the whole app
 * displays dates in; `null` means none was set, so the frontend falls back to
 * each device's local timezone.
 */
export type AppConfig = {
  tz: string | null;
};

export type ApiError = {
  error: {
    message: string;
  };
};

export interface PanelRepository {
  list(filter?: BuildingScopedFilter): Promise<Panel[]>;
  create(input: {
    name: string;
    orientation?: PanelOrientation;
    slotCount?: number;
    /** G39 cycle-56 — optional parent breaker id at creation time. */
    parentBreakerId?: string | null;
    /** 2026-05 — owning building; repo defaults to the default building. */
    buildingId?: string;
  }): Promise<Panel>;
  get(id: string): Promise<Panel | null>;
  update(id: string, patch: PanelUpdate): Promise<Panel | null>;
  delete(id: string): Promise<boolean>;
  /** 2026-05 — move this panel (and the components wired to its breakers)
   *  into another building, cleaning up cross-building references. Returns
   *  the updated panel, or null if it doesn't exist. */
  moveToBuilding(panelId: string, buildingId: string): Promise<Panel | null>;
  setFloorPlan(panelId: string, plan: FloorPlan): Promise<Panel | null>;
  clearFloorPlan(panelId: string): Promise<Panel | null>;
}

export const panelOrientationSchema = z.enum(['vertical', 'horizontal']);

// `name` rejects whitespace-only inputs to match the pre-G18 panel-route
// contract (server.test.ts: POST {name: '   '} must 400).
const panelNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => s.trim().length > 0, 'name cannot be blank');

export const panelInputSchema = z.object({
  name: panelNameSchema,
  orientation: panelOrientationSchema.optional(),
  slotCount: z.number().int().min(1).max(200).optional(),
  /** G39 cycle-56 — optional feeder-breaker link at creation. */
  parentBreakerId: z.string().min(1).nullable().optional(),
  /** 2026-05 — owning building. Optional on the wire (the repo falls back to
   *  the default building); the frontend always sends the active building. */
  buildingId: z.string().min(1).optional(),
});

export const panelPatchSchema = z.object({
  name: panelNameSchema.optional(),
  orientation: panelOrientationSchema.optional(),
  slotCount: z.number().int().min(1).max(200).optional(),
  /** G39 cycle-56 — set to breaker id to wire as subpanel; set to null
   *  to detach. Server-side rejects cycles + self-feed. */
  parentBreakerId: z.string().min(1).nullable().optional(),
});

export const panelSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
  orientation: panelOrientationSchema,
  slotCount: z.number().int().min(1).max(200),
  parentBreakerId: z.string().nullable(),
});

export type PanelInputParsed = z.infer<typeof panelInputSchema>;
export type PanelPatchParsed = z.infer<typeof panelPatchSchema>;

export const newId = (): string => ulid();

// --- Buildings (top-level: a house / building / property) ---
//
// The top of the hierarchy (added 2026-05): every panel, floor, and component
// belongs to exactly one building via a NOT NULL `building_id` FK. Deleting a
// building cascades to its entire tree. A deployment holds many buildings; the
// active one is chosen client-side (BuildingContext) and threaded into every
// list/create call. Panel + floor names are unique WITHIN a building.

export type Building = {
  id: string;
  name: string;
  createdAt: number;
};

export type BuildingInput = {
  name: string;
};

const buildingNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => s.trim().length > 0, 'name cannot be blank');

export const buildingInputSchema = z.object({
  name: buildingNameSchema,
});

export const buildingPatchSchema = z.object({
  name: buildingNameSchema.optional(),
});

export const buildingSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type BuildingInputParsed = z.infer<typeof buildingInputSchema>;
export type BuildingPatchParsed = z.infer<typeof buildingPatchSchema>;

/** Body for the move-to-building endpoints (panels/floors). */
export const moveToBuildingSchema = z.object({
  buildingId: z.string().min(1),
});

export interface BuildingRepository {
  list(): Promise<Building[]>;
  create(input: BuildingInput): Promise<Building>;
  get(id: string): Promise<Building | null>;
  update(id: string, patch: Partial<BuildingInput>): Promise<Building | null>;
  delete(id: string): Promise<boolean>;
}

// --- Breakers ---

/** G37 cycle-68 — GFCI/AFCI protection kind. Closed NEC nomenclature; same
 *  enum applies to BOTH breakers + components (a protection device can be
 *  on the breaker — AFCI/GFCI breaker — OR on the receptacle — GFCI outlet).
 *  CHECK enum at the DB layer is defensible because the set is closed; see
 *  CLAUDE.md "GFCI/AFCI protection (G37 Part 1 — cycle-68)". */
export type ProtectionKind = 'gfci' | 'afci' | 'dual';

export type Poles = 'single' | 'double' | 'tandem';

/** G34 cycle-42 — tandem breakers stuff two single-pole circuits into
 *  one stab. Each half is its OWN circuit row in the breakers table,
 *  distinguished by `tandemHalf`. A slot N may host EITHER:
 *    - one non-tandem breaker (tandemHalf = null), OR
 *    - up to two tandem-half breakers (one 'a' + one 'b').
 *  Non-tandem (single + double) breakers always carry tandemHalf = null. */
export type TandemHalf = 'a' | 'b';

export type Breaker = {
  id: string;
  panelId: string;
  slot: string;
  slotPosition: number | null;
  amperage: number;
  poles: Poles;
  label: string;
  /** G34: 'a' or 'b' when poles === 'tandem'; null otherwise. */
  tandemHalf: TandemHalf | null;
  /** G37 cycle-68 — GFCI/AFCI/dual protection on the breaker itself
   *  (AFCI breaker, GFCI breaker, dual-function CAFCI/GFCI). null = no
   *  protection on the breaker (the circuit may still have a downstream
   *  GFCI receptacle). */
  protection: ProtectionKind | null;
  createdAt: number;
};

export type BreakerInput = {
  slot: string;
  amperage: number;
  poles: Poles;
  label: string;
  slotPosition?: number | null;
  /** G34: required when poles === 'tandem'; ignored otherwise. Server-side
   *  validation rejects (tandem without half) and (non-tandem with half). */
  tandemHalf?: TandemHalf | null;
  /** G37 cycle-68 — optional GFCI/AFCI/dual marker. Default null. */
  protection?: ProtectionKind | null;
};

export interface BreakerRepository {
  listByPanel(panelId: string): Promise<Breaker[]>;
  create(panelId: string, input: BreakerInput): Promise<Breaker>;
  get(id: string): Promise<Breaker | null>;
  update(id: string, patch: Partial<BreakerInput>): Promise<Breaker | null>;
  delete(id: string): Promise<boolean>;
  deleteByPanel(panelId: string): Promise<void>;
}

export const polesSchema = z.enum(['single', 'double', 'tandem']);
export const tandemHalfSchema = z.enum(['a', 'b']);
/** G37 cycle-68 — closed NEC nomenclature. */
export const protectionKindSchema = z.enum(['gfci', 'afci', 'dual']);

export const breakerInputSchema = z.object({
  slot: z.string().min(1).max(16),
  amperage: z.number().int().positive().max(400),
  poles: polesSchema,
  label: z.string().min(1).max(120),
  slotPosition: z.number().int().nonnegative().nullable().optional(),
  /** G34: tandem half ('a' | 'b'). Required when poles === 'tandem'.
   *  Server-side validator enforces the cross-field rule. */
  tandemHalf: tandemHalfSchema.nullable().optional(),
  /** G37 cycle-68 — optional protection marker. Default null. */
  protection: protectionKindSchema.nullable().optional(),
});

export const breakerPatchSchema = breakerInputSchema.partial();

export const breakerSchema = z.object({
  id: z.string(),
  panelId: z.string(),
  slot: z.string(),
  slotPosition: z.number().int().nonnegative().nullable(),
  amperage: z.number().int().positive(),
  poles: polesSchema,
  label: z.string(),
  tandemHalf: tandemHalfSchema.nullable(),
  protection: protectionKindSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
});

export type BreakerInputParsed = z.infer<typeof breakerInputSchema>;
export type BreakerPatchParsed = z.infer<typeof breakerPatchSchema>;

// --- Components ---

export type ComponentType =
  | 'outlet'
  | 'light'
  | 'switch'
  | 'appliance'
  | 'junction_box'
  | 'smoke_detector'
  | 'other';

export type Component = {
  id: string;
  type: ComponentType;
  name: string;
  room: string | null;
  notes: string | null;
  /** G35 Part 2 (cycle-59) — user-flagged priority device (fridge, freezer,
   *  well pump, sump pump, modem, medical device, etc.). Surfaces a warn-
   *  orange badge in the Impact modal + components list + test mode. Stored
   *  as a 0/1 SMALLINT (the bool-as-int convention, carried over from the
   *  SQLite era); mapped to JS bool by `rowToComponent`. */
  critical: boolean;
  breakerId: string | null;
  /** G13 — which floor this component sits on. `null` means unplaced
   *  with respect to floors (component may still have a posX/posY left
   *  over from G4 baseline). */
  floorId: string | null;
  posX: number | null;
  posY: number | null;
  /** G19 — for type='switch', how many independent toggles in this gang
   *  box (1=single-gang, 2=double, etc, up to 8). For all other types,
   *  always 1; the value is ignored by the UI for non-switches. */
  gangs: number;
  /** G37 cycle-68 — GFCI/AFCI/dual protection on the component itself
   *  (e.g. a GFCI outlet). null = no protection on the component. Same
   *  enum as Breaker.protection — a circuit's protection can live on
   *  EITHER end (breaker or receptacle). */
  protection: ProtectionKind | null;
  /** 2026-05 — estimated continuous load in WATTS, for per-circuit load
   *  tracking + overload warnings. `null` = unknown (the user hasn't
   *  estimated it). Per-type typical defaults are OFFERED in the form but
   *  the value is always user-overridable. Switches/junction boxes draw no
   *  load themselves (the load is the thing they control). */
  loadWatts: number | null;
  createdAt: number;
};

export type ComponentInput = {
  type: ComponentType;
  name: string;
  room?: string | null;
  notes?: string | null;
  breakerId?: string | null;
  floorId?: string | null;
  /** 2026-05 — owning building; repo defaults to the default building. */
  buildingId?: string;
  posX?: number | null;
  posY?: number | null;
  /** G19 — see Component.gangs. Default 1. */
  gangs?: number;
  /** G35 Part 2 (cycle-59) — see Component.critical. Default false. */
  critical?: boolean;
  /** G37 cycle-68 — see Component.protection. Default null. */
  protection?: ProtectionKind | null;
  /** 2026-05 — see Component.loadWatts. Default null (unknown). */
  loadWatts?: number | null;
};

/** G19 — link from a switch's gang to a component it controls (light /
 *  outlet). Many-to-many via the switch_controls table. */
export type SwitchControl = {
  switchId: string;
  gangIndex: number; // 0-based in storage; UI presents as Gang N+1
  controlledId: string;
};

export type ResolvedSwitchControl = {
  switchId: string;
  gangIndex: number;
  controlled: ResolvedComponent;
};

export type ComponentListFilter = {
  room?: string;
  type?: ComponentType;
  breakerId?: string;
  /** G13 — filter to one floor. Exact match. */
  floorId?: string;
  search?: string;
  /** 2026-05 — scope to one building. Exact match. */
  buildingId?: string;
};

/** Filter shared by the top-level collection repos (panels, floors). */
export type BuildingScopedFilter = {
  buildingId?: string;
};

export interface ComponentRepository {
  list(filter?: ComponentListFilter): Promise<ResolvedComponent[]>;
  create(input: ComponentInput): Promise<Component>;
  get(id: string): Promise<ResolvedComponent | null>;
  update(id: string, patch: Partial<ComponentInput>): Promise<Component | null>;
  delete(id: string): Promise<boolean>;
}

export const componentTypeSchema = z.enum([
  'outlet',
  'light',
  'switch',
  'appliance',
  'junction_box',
  'smoke_detector',
  'other',
]);

// --- Floor-plan coordinate space (walls / rooms / component pins) ---
//
// The vector editor renders through a FIXED 0-10000 viewBox "window"; the
// viewport (pan + zoom) slides a much larger logical canvas underneath it,
// so geometry can legitimately live far outside the initial window — the
// plan feels effectively unbounded. These generous SYMMETRIC bounds are the
// single source of truth for that space: they keep coordinates well within
// 32-bit INTEGER range (Postgres `INTEGER`), keep fit-to-content usable, and
// are mirrored in THREE places that MUST stay in sync:
//   1. these zod schemas (API + form validation),
//   2. the walls/rooms CHECK constraints in backend repository.ts,
//   3. the snap() clamp in frontend lib/snap.ts.
// The 10000 normalization SCALE is unchanged — only the clamp widened — so
// existing data + the `/10000` image-relative math keep their meaning.
export const COORD_MIN = -100000;
export const COORD_MAX = 100000;
/** Max room width/height = the full span of the coordinate range. */
export const ROOM_DIM_MAX = COORD_MAX - COORD_MIN;

export const componentInputSchema = z.object({
  type: componentTypeSchema,
  name: z.string().min(1).max(120),
  room: z.string().min(1).max(60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  breakerId: z.string().min(1).nullable().optional(),
  floorId: z.string().min(1).nullable().optional(),
  /** 2026-05 — owning building (repo defaults to the default building). */
  buildingId: z.string().min(1).optional(),
  posX: z.number().int().min(COORD_MIN).max(COORD_MAX).nullable().optional(),
  posY: z.number().int().min(COORD_MIN).max(COORD_MAX).nullable().optional(),
  gangs: z.number().int().min(1).max(8).optional(),
  /** G35 Part 2 (cycle-59) — critical flag. Optional on input; the repo
   *  defaults to false when absent. PATCH accepts true/false to toggle. */
  critical: z.boolean().optional(),
  /** G37 cycle-68 — GFCI/AFCI/dual protection. Optional on input; the repo
   *  defaults to null when absent. PATCH accepts a ProtectionKind or null. */
  protection: protectionKindSchema.nullable().optional(),
  /** 2026-05 — estimated continuous load in watts. Optional; null = unknown.
   *  Capped at 100000 W (defensive — a residential circuit tops out far
   *  below this; the cap just rejects obviously-bad input). */
  loadWatts: z.number().int().min(0).max(100000).nullable().optional(),
});

export const switchControlInputSchema = z.object({
  gangIndex: z.number().int().min(0).max(7),
  controlledId: z.string().min(1),
});

export const componentPatchSchema = componentInputSchema.partial();

export const componentsListQuerySchema = z.object({
  room: z.string().min(1).max(60).optional(),
  type: componentTypeSchema.optional(),
  breakerId: z.string().min(1).optional(),
  floorId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  /** 2026-05 — scope the list to one building. */
  buildingId: z.string().min(1).optional(),
});

export const componentSchema = z.object({
  id: z.string(),
  type: componentTypeSchema,
  name: z.string(),
  room: z.string().nullable(),
  notes: z.string().nullable(),
  critical: z.boolean(),
  breakerId: z.string().nullable(),
  floorId: z.string().nullable(),
  gangs: z.number().int().min(1).max(8),
  protection: protectionKindSchema.nullable(),
  loadWatts: z.number().int().min(0).max(100000).nullable(),
  createdAt: z.number().int().nonnegative(),
});

export type ComponentInputParsed = z.infer<typeof componentInputSchema>;
export type ComponentPatchParsed = z.infer<typeof componentPatchSchema>;
export type ComponentsListQueryParsed = z.infer<typeof componentsListQuerySchema>;

// --- Resolved component (with inline breaker info for click-to-identify) ---

export type ResolvedBreakerSummary = {
  id: string;
  panelId: string;
  panelName: string;
  slot: string;
  slotPosition: number | null;
  label: string;
  amperage: number;
  poles: Poles;
  tandemHalf: TandemHalf | null;
};

export type ResolvedComponent = Component & {
  breaker: ResolvedBreakerSummary | null;
};

export const resolvedBreakerSummarySchema = z.object({
  id: z.string(),
  panelId: z.string(),
  panelName: z.string(),
  slot: z.string(),
  slotPosition: z.number().int().nonnegative().nullable(),
  label: z.string(),
  amperage: z.number().int().positive(),
  poles: polesSchema,
});

export const resolvedComponentSchema = componentSchema.extend({
  breaker: resolvedBreakerSummarySchema.nullable(),
});

// --- Floors (G13 — multi-floor data model) ---
//
// Floors are home-scoped: in single-house mode (single-user, single-house),
// they have NO parent FK. A future multi-house migration adds a nullable
// `house_id`, backfills, then NOT NULL. Do NOT retrofit a parent FK
// speculatively. See CLAUDE.md "Multi-floor model (G13)" for the contract.

export type Floor = {
  id: string;
  name: string;
  displayOrder: number | null;
  createdAt: number;
  floorPlan: FloorPlan | null;
  /** Cycle-85 — linked panel. When set, components placed on this floor
   *  default-wire to a breaker on this panel (user can still override
   *  per-component). Null = no default. ON DELETE SET NULL at the FK. */
  panelId: string | null;
};

export type FloorInput = {
  name: string;
  displayOrder?: number | null;
  /** Cycle-85 — set on create or PATCH to wire the floor's default panel. */
  panelId?: string | null;
  /** 2026-05 — owning building; repo defaults to the default building. */
  buildingId?: string;
};

export interface FloorRepository {
  list(filter?: BuildingScopedFilter): Promise<Floor[]>;
  create(input: FloorInput): Promise<Floor>;
  get(id: string): Promise<Floor | null>;
  update(id: string, patch: Partial<FloorInput>): Promise<Floor | null>;
  delete(id: string): Promise<boolean>;
  /** 2026-05 — move this floor (and the components placed on it) into another
   *  building, cleaning up cross-building references. Null if not found. */
  moveToBuilding(floorId: string, buildingId: string): Promise<Floor | null>;
  setFloorPlan(floorId: string, plan: FloorPlan): Promise<Floor | null>;
  clearFloorPlan(floorId: string): Promise<Floor | null>;
}

export const floorInputSchema = z.object({
  name: z.string().min(1).max(120),
  displayOrder: z.number().int().nonnegative().nullable().optional(),
  /** Cycle-85 — non-empty string when set, or null to clear. */
  panelId: z.string().min(1).nullable().optional(),
  /** 2026-05 — owning building (repo defaults to the default building). */
  buildingId: z.string().min(1).optional(),
});

export const floorPatchSchema = floorInputSchema.partial();

export const floorSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayOrder: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  floorPlan: z
    .object({
      filename: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
  panelId: z.string().nullable(),
});

export type FloorInputParsed = z.infer<typeof floorInputSchema>;
export type FloorPatchParsed = z.infer<typeof floorPatchSchema>;

// --- Walls (G12 — vector floor-plan editor, walls subset) ---
//
// Walls are floor-scoped line segments with endpoints in the same
// 0-10000 normalized coordinate space components.posX/posY uses. floor_id
// is NOT NULL (a wall can't exist without a floor; differs from
// components.floor_id which is nullable). Deleting a floor cascades to
// its walls via ON DELETE CASCADE (also differs — components SET NULL).
// Pin: see CLAUDE.md "Wall editor (G12 walls)" for the rationale.

export type Wall = {
  id: string;
  floorId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  createdAt: number;
};

export type WallInput = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export interface WallRepository {
  listByFloor(floorId: string): Promise<Wall[]>;
  create(floorId: string, input: WallInput): Promise<Wall>;
  get(id: string): Promise<Wall | null>;
  update(id: string, patch: Partial<WallInput>): Promise<Wall | null>;
  delete(id: string): Promise<boolean>;
}

// Endpoints live in the unbounded coordinate space (see COORD_MIN/MAX).
const coord = z.number().int().min(COORD_MIN).max(COORD_MAX);

export const wallInputSchema = z.object({
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
});

export const wallPatchSchema = wallInputSchema.partial();

export const wallSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  createdAt: z.number().int().nonnegative(),
});

export type WallInputParsed = z.infer<typeof wallInputSchema>;
export type WallPatchParsed = z.infer<typeof wallPatchSchema>;

// --- Rooms (G12 — vector floor-plan editor, rooms subset) ---
//
// Rooms are axis-aligned rectangles on a floor, with a free-text name
// rendered as a center-of-rectangle SVG <text> label. Stored as (x, y, w, h)
// integers in the same 0-10000 normalized coord space as walls + components.
// floor_id is NOT NULL + ON DELETE CASCADE (same invariants as walls). PATCH
// never accepts floor_id — rooms don't move between floors.
//
// Polygons are deferred — see CLAUDE.md "Room editor (G12 rooms)" for the
// documented migration path (add `points` blob, backfill 4-point arrays
// from rectangles, drop x/y/w/h columns).

/** A single polygon vertex in the 0-10000 (now unbounded) coord space. */
export type RoomVertex = { x: number; y: number };

export type Room = {
  id: string;
  floorId: string;
  name: string;
  /** Axis-aligned bounding box of `points` — kept in sync server-side.
   *  Used for label centering + the rectangle X/Y/W/H sidebar editor. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ordered polygon vertices (>= 3). A rectangle room is a 4-point
   *  axis-aligned polygon; a wall-loop room is an N-point polygon. This is
   *  the canonical shape — `x/y/w/h` are derived from it. */
  points: RoomVertex[];
  createdAt: number;
};

/** Create a room either as a rectangle (x/y/w/h) OR a polygon (points).
 *  The backend normalizes to BOTH representations (points + bbox). */
export type RoomInput = {
  name: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points?: RoomVertex[];
};

/** Four corners (clockwise from top-left) of an axis-aligned rectangle. */
export const rectToPolygon = (
  x: number,
  y: number,
  w: number,
  h: number
): RoomVertex[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Axis-aligned bounding box of a polygon (>= 1 point). */
export const polygonBounds = (
  points: ReadonlyArray<RoomVertex>
): { x: number; y: number; w: number; h: number } => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
};

/** True when `points` is exactly a 4-vertex axis-aligned rectangle — the
 *  rooms editable via the rectangle X/Y/W/H + corner-resize UI. Wall-loop
 *  rooms (and freely-reshaped polygons) are edited via per-vertex drag. */
export const isAxisAlignedRect = (
  points: ReadonlyArray<RoomVertex>
): boolean => {
  if (points.length !== 4) return false;
  const xs = new Set(points.map((p) => p.x));
  const ys = new Set(points.map((p) => p.y));
  return xs.size === 2 && ys.size === 2;
};

export interface RoomRepository {
  listByFloor(floorId: string): Promise<Room[]>;
  /** Cycle-85 — flat house-level read for ComponentForm Room datalist
   *  autocomplete (so room names typed elsewhere are suggested too).
   *  Returns rooms across ALL floors. Same sort as listByFloor: oldest
   *  first, id-stable for ties. */
  listAll(): Promise<Room[]>;
  create(floorId: string, input: RoomInput): Promise<Room>;
  get(id: string): Promise<Room | null>;
  update(id: string, patch: Partial<RoomInput>): Promise<Room | null>;
  delete(id: string): Promise<boolean>;
}

// Width/height must be >= 1 so the schema rejects zero-area rectangles
// (they'd be invisible). Coordinates use the unbounded space (COORD_MIN/MAX);
// width/height may span the full range.
const roomCoord = z.number().int().min(COORD_MIN).max(COORD_MAX);
const roomDim = z.number().int().min(1).max(ROOM_DIM_MAX);
const roomVertex = z.object({ x: roomCoord, y: roomCoord });
// A polygon needs >= 3 vertices; cap at 64 to bound payload size (a house
// room is realistically < 20 corners even for complex layouts).
const roomPolygon = z.array(roomVertex).min(3).max(64);

// A room's shape may be supplied as a rectangle (x/y/w/h) OR a polygon
// (points). The base object keeps every shape field optional so `.partial()`
// yields a clean PATCH schema; `roomInputSchema` refines that at least one
// complete shape is present on CREATE.
const roomShapeObject = z.object({
  name: z.string().min(1).max(120),
  x: roomCoord.optional(),
  y: roomCoord.optional(),
  w: roomDim.optional(),
  h: roomDim.optional(),
  points: roomPolygon.optional(),
});

export const roomInputSchema = roomShapeObject.refine(
  (v) =>
    v.points !== undefined ||
    (v.x !== undefined &&
      v.y !== undefined &&
      v.w !== undefined &&
      v.h !== undefined),
  { message: 'Provide either polygon points or x/y/w/h.' }
);

export const roomPatchSchema = roomShapeObject.partial();

export const roomSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  name: z.string(),
  x: roomCoord,
  y: roomCoord,
  w: roomDim,
  h: roomDim,
  points: roomPolygon,
  createdAt: z.number().int().nonnegative(),
});

export type RoomInputParsed = z.infer<typeof roomInputSchema>;
export type RoomPatchParsed = z.infer<typeof roomPatchSchema>;

// --- Breaker tests (G36 — cycle-61, audit trail) ---
//
// Every "Mark verified" tap on TestPanelScreen writes one row to
// `breaker_tests`. G7's walk-through workflow stops being ephemeral —
// BreakerRow shows "Last verified: X ago" pulled from the latest row
// for that breaker. See CLAUDE.md "Breaker-test audit trail (G36 —
// cycle-61)" for the pinned contract.
//
// - `outcome` is FREE TEXT (no CHECK enum, per the cycle-3
//   frozen-enum-when-needed precedent). Future formalization to an
//   enum waits for real usage to surface stable buckets.
// - `tested_at` is epoch milliseconds (cycle-1 timestamp pin).
// - ON DELETE CASCADE on breaker_id at the FK level + belt-and-
//   suspenders DELETE in PgBreakerRepository.delete() + deleteByPanel().

export type BreakerTest = {
  id: string;
  breakerId: string;
  testedAt: number;
  outcome: string | null;
  notes: string | null;
  createdAt: number;
};

export type BreakerTestInput = {
  breakerId: string;
  /** Defaults to Date.now() on the server when omitted. */
  testedAt?: number;
  outcome?: string | null;
  notes?: string | null;
};

export type BreakerTestListFilter = {
  breakerId?: string;
  /** Inclusive: rows where tested_at >= since. */
  since?: number;
  /** G36 Part 2 (cycle-63) — inclusive: rows where tested_at <= until. */
  until?: number;
  /** Exact-match free text. */
  outcome?: string;
  /** G36 Part 2 (cycle-63) — max rows. Caller (route) caps to 200 by default
   *  for the /audit screen. Unset = unlimited (used by latestByBreaker
   *  internally via its own LIMIT 1 query). */
  limit?: number;
};

/** G36 Part 2 (cycle-63) — paginated list result. `data` is the (limited)
 *  rows; `totalCount` is the count BEFORE the limit was applied so the UI
 *  can render "Showing most-recent N of M" hints. */
export type BreakerTestListResult = {
  data: BreakerTest[];
  totalCount: number;
};

export interface BreakerTestRepository {
  /** G36 Part 2 (cycle-63) — returns paginated result with totalCount. */
  list(filter?: BreakerTestListFilter): Promise<BreakerTestListResult>;
  create(input: BreakerTestInput): Promise<BreakerTest>;
  delete(id: string): Promise<boolean>;
  /** Returns a Map keyed by breakerId. Missing keys → no test ever ran. */
  latestByBreaker(
    breakerIds: readonly string[]
  ): Promise<Map<string, BreakerTest | null>>;
}

/** POST body — breakerId comes from the URL path; outcome/notes/testedAt
 *  optional. The schema is permissive on outcome (any non-empty string up
 *  to 120 chars). */
export const breakerTestInputSchema = z.object({
  testedAt: z.number().int().nonnegative().optional(),
  outcome: z.string().min(1).max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const breakerTestListQuerySchema = z.object({
  breakerId: z.string().min(1).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  /** G36 Part 2 (cycle-63) — upper bound, inclusive epoch ms. */
  until: z.coerce.number().int().nonnegative().optional(),
  outcome: z.string().min(1).max(120).optional(),
  /** G36 Part 2 (cycle-63) — page size. Route caps to 200 server-side. */
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export const breakerTestSchema = z.object({
  id: z.string(),
  breakerId: z.string(),
  testedAt: z.number().int().nonnegative(),
  outcome: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
});

export type BreakerTestInputParsed = z.infer<typeof breakerTestInputSchema>;
export type BreakerTestListQueryParsed = z.infer<typeof breakerTestListQuerySchema>;

// --- Service entries (G40 Part 1 — cycle-66) ---
//
// Dated service-log entries attached polymorphically to either a breaker
// or a component. Surface: small timeline on the row + modal-expand.
// Closes the gap left by components.notes (static descriptive notes
// remain — service_entries are time-stamped events alongside, NOT a
// replacement).
//
// - parent_type is a closed app-level enum ({'breaker','component'}); the
//   CHECK constraint is defensible because adding a 3rd value (floor,
//   room) would require an explicit table rebuild + ADR (same precedent
//   as cycle-3 component types). Differs from cycle-61 outcome which is
//   free user text with no enum.
// - No polymorphic FK — a (parent_type, parent_id) pair can't be expressed
//   as a foreign key in any engine. Cascade is APP-LEVEL in 3 sites
//   (PgBreakerRepository.delete + .deleteByPanel +
//   PgComponentRepository.delete).
// - URL convention: nested writers (URL-driven polymorphism, NOT body-
//   driven parent_type) + flat query.
// - See CLAUDE.md "Service-log entries (G40 Part 1 — cycle-66)".

export type ServiceEntryParentType = 'breaker' | 'component';

export type ServiceEntry = {
  id: string;
  parentType: ServiceEntryParentType;
  parentId: string;
  occurredAt: number;
  note: string;
  createdAt: number;
};

export type ServiceEntryInput = {
  /** Defaults to Date.now() on the server when omitted. */
  occurredAt?: number;
  note: string;
};

export type ServiceEntryListFilter = {
  parentType?: ServiceEntryParentType;
  parentId?: string;
  /** Bulk parent-id list for one-shot fetch (used by PanelDetailScreen
   *  to load entries for every breaker on the panel in one round-trip).
   *  When provided, parentType MUST also be provided. */
  parentIds?: readonly string[];
  /** Inclusive: rows where occurred_at >= since. */
  since?: number;
  /** Inclusive: rows where occurred_at <= until. */
  until?: number;
  /** Max rows. Route caps to 200 by default (DEFAULT_SERVICE_LIMIT). */
  limit?: number;
};

/** Paginated list result. `data` is the (limited) rows; `totalCount` is
 *  the count BEFORE the limit was applied so the UI can render
 *  "Showing N of M" hints. Matches the cycle-63 audit-trail shape. */
export type ServiceEntryListResult = {
  data: ServiceEntry[];
  totalCount: number;
};

export interface ServiceEntryRepository {
  list(filter?: ServiceEntryListFilter): Promise<ServiceEntryListResult>;
  create(input: {
    parentType: ServiceEntryParentType;
    parentId: string;
    occurredAt?: number;
    note: string;
  }): Promise<ServiceEntry>;
  delete(id: string): Promise<boolean>;
}

export const serviceEntryParentTypeSchema = z.enum(['breaker', 'component']);

/** POST body — parentType + parentId come from the URL path; the only
 *  required body field is `note`. */
export const serviceEntryInputSchema = z.object({
  note: z.string().min(1).max(2000),
  occurredAt: z.number().int().nonnegative().optional(),
});

export const serviceEntryListQuerySchema = z.object({
  parentType: serviceEntryParentTypeSchema.optional(),
  parentId: z.string().min(1).optional(),
  /** Comma-separated parent ids. The route parses this into string[]. */
  parentIds: z.string().min(1).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export const serviceEntrySchema = z.object({
  id: z.string(),
  parentType: serviceEntryParentTypeSchema,
  parentId: z.string(),
  occurredAt: z.number().int().nonnegative(),
  note: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type ServiceEntryInputParsed = z.infer<typeof serviceEntryInputSchema>;
export type ServiceEntryListQueryParsed = z.infer<
  typeof serviceEntryListQuerySchema
>;

// ── Attachments (photos on components & breakers — 2026-05) ─────────────────

/** Polymorphic parent kinds for an uploaded photo. Closed app-level enum
 *  (DB CHECK), mirroring service_entries' parent_type. */
export type AttachmentParentType = 'component' | 'breaker';

/** An uploaded image attached to a component or breaker. `filename` is the
 *  on-disk name under FLOOR_PLAN_DIR (served via /files/floor-plans/<filename>);
 *  the DB stores the filename only, NOT a URL — same contract as floor plans,
 *  so the deployment topology stays out of the database. */
export type Attachment = {
  id: string;
  parentType: AttachmentParentType;
  parentId: string;
  filename: string;
  createdAt: number;
};

export interface AttachmentRepository {
  listByParent(
    parentType: AttachmentParentType,
    parentId: string
  ): Promise<Attachment[]>;
  create(input: {
    parentType: AttachmentParentType;
    parentId: string;
    filename: string;
  }): Promise<Attachment>;
  get(id: string): Promise<Attachment | null>;
  delete(id: string): Promise<boolean>;
}

export const attachmentParentTypeSchema = z.enum(['component', 'breaker']);

export const attachmentSchema = z.object({
  id: z.string(),
  parentType: attachmentParentTypeSchema,
  parentId: z.string(),
  filename: z.string(),
  createdAt: z.number().int().nonnegative(),
});

// ── App user (single-user login gate — sign-up flow) ────────────────────────

/**
 * The single account row in `app_users`. Created via the first-time
 * sign-up flow. There is exactly 0 or 1 row at any moment — sign-up
 * is rejected with 409 when a user already exists.
 *
 * `passwordHash` is a scrypt-encoded string (see backend/src/password.ts).
 * The repo never returns it from `list`-style reads — only internally
 * for `verifyPassword(supplied, row.passwordHash)`.
 */
export type AppUser = {
  id: string;
  username: string;
  /** scrypt-encoded password hash. Never exposed over the network. */
  passwordHash: string;
  createdAt: number;
};

export interface AppUserRepository {
  /** True iff the table has >=1 row. Drives the sign-up vs login pivot. */
  hasAnyUser(): Promise<boolean>;
  /** The single user, if one exists. */
  getSingle(): Promise<AppUser | null>;
  /** Fetch by username — used by the /auth/login route. */
  getByUsername(username: string): Promise<AppUser | null>;
  /** Create the (one and only) user. Throws if a user already exists. */
  create(input: { username: string; passwordHash: string }): Promise<AppUser>;
  /** Replace the stored passwordHash for an existing user. */
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Username must not be empty.')
  .max(120, 'Username is too long.');

// Min 8 chars — reasonable for a single-user LAN PWA. The signup form
// surfaces this as a hint so users aren't surprised by the rejection.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(512, 'Password is too long.');

export const signupInputSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict();

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: passwordSchema,
  })
  .strict();

export type SignupInputParsed = z.infer<typeof signupInputSchema>;
export type ChangePasswordInputParsed = z.infer<
  typeof changePasswordInputSchema
>;

// ── Building export/import envelope (G43 — 2026-05) ──────────────────────────
//
// The single source of truth for the `house-electricals-building-export`
// payload shape. The EXPORT route's output type (`BuildingExport` in
// routes/export.ts) is derived from `BuildingExportParsed` below, and the
// IMPORT route validates incoming payloads with `buildingExportSchema`. Sharing
// one schema makes "what export writes" provably identical to "what import
// accepts" — they can never silently drift apart.

/** A switch_controls triple. Composed here (vs reusing the input schema, which
 *  omits `switchId` because that comes from the URL path on the write route) so
 *  the export/import envelope carries the full link. Mirrors the `SwitchControl`
 *  type. */
export const switchControlSchema = z.object({
  switchId: z.string(),
  gangIndex: z.number().int().min(0).max(7),
  controlledId: z.string(),
});

/** The exported component carries `posX`/`posY` (placement on a floor plan).
 *  The base `componentSchema` omits them — it predates the export feature and
 *  is only used for type inference elsewhere — so the export envelope extends
 *  it. Keep bounds in sync with `componentInputSchema`'s posX/posY. */
export const exportComponentSchema = componentSchema.extend({
  posX: z.number().int().min(COORD_MIN).max(COORD_MAX).nullable(),
  posY: z.number().int().min(COORD_MIN).max(COORD_MAX).nullable(),
});

export const buildingExportSchema = z.object({
  format: z.literal('house-electricals-building-export'),
  version: z.literal(1),
  exportedAt: z.number(),
  building: buildingSchema,
  floors: z.array(floorSchema),
  rooms: z.array(roomSchema),
  walls: z.array(wallSchema),
  panels: z.array(panelSchema),
  breakers: z.array(breakerSchema),
  components: z.array(exportComponentSchema),
  switchControls: z.array(switchControlSchema),
  serviceEntries: z.array(serviceEntrySchema),
  breakerTests: z.array(breakerTestSchema),
});

export type BuildingExportParsed = z.infer<typeof buildingExportSchema>;
