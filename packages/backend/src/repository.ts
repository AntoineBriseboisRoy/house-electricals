import { Db } from './db.js';
import {
  newId,
  polygonBounds,
  rectToPolygon,
  type AppUser,
  type AppUserRepository,
  type Breaker,
  type BreakerInput,
  type BreakerRepository,
  type BreakerTest,
  type BreakerTestInput,
  type BreakerTestListFilter,
  type BreakerTestListResult,
  type BreakerTestRepository,
  type Building,
  type BuildingInput,
  type BuildingRepository,
  type Component,
  type ComponentInput,
  type ComponentListFilter,
  type ComponentRepository,
  type ComponentType,
  type Floor,
  type FloorInput,
  type FloorPlan,
  type FloorRepository,
  type Panel,
  type PanelRepository,
  type Poles,
  type PanelOrientation,
  type PanelUpdate,
  type ProtectionKind,
  type ResolvedComponent,
  type Room,
  type RoomInput,
  type RoomRepository,
  type RoomVertex,
  type ServiceEntry,
  type ServiceEntryListFilter,
  type ServiceEntryListResult,
  type ServiceEntryParentType,
  type ServiceEntryRepository,
  type Wall,
  type WallInput,
  type WallRepository,
} from '@he/shared';

type PanelRow = {
  id: string;
  name: string;
  created_at: number;
  floor_plan_filename: string | null;
  image_width: number | null;
  image_height: number | null;
  orientation: PanelOrientation;
  slot_count: number;
  /** G39 cycle-56 — subpanel hierarchy. Nullable FK to breakers.id. */
  parent_breaker_id: string | null;
};

type BreakerRow = {
  id: string;
  panel_id: string;
  slot: string;
  slot_position: number | null;
  amperage: number;
  poles: Poles;
  label: string;
  /** G34: 'a' | 'b' for tandem breakers, null otherwise. */
  tandem_half: 'a' | 'b' | null;
  /** G37 cycle-68: 'gfci' | 'afci' | 'dual' | null. */
  protection: ProtectionKind | null;
  created_at: number;
};

type ComponentRow = {
  id: string;
  type: ComponentType;
  name: string;
  room: string | null;
  notes: string | null;
  breaker_id: string | null;
  floor_id: string | null;
  pos_x: number | null;
  pos_y: number | null;
  gangs: number;
  /** G35 Part 2 (cycle-59) — stored as SMALLINT 0/1 (pg parses int2 as a JS
   *  number). 0 = not critical (default), 1 = critical. Mapped to JS bool by
   *  rowToComponent. The 0/1 storage convention is carried over from the
   *  SQLite era so the mapper logic (`row.critical === 1`) is unchanged. */
  critical: 0 | 1;
  /** G37 cycle-68: 'gfci' | 'afci' | 'dual' | null. */
  protection: ProtectionKind | null;
  created_at: number;
};

type FloorRow = {
  id: string;
  name: string;
  display_order: number | null;
  floor_plan_filename: string | null;
  floor_plan_width: number | null;
  floor_plan_height: number | null;
  created_at: number;
  /** Cycle-85 — nullable FK to panels(id), ON DELETE SET NULL. */
  panel_id: string | null;
};

type ResolvedComponentRow = ComponentRow & {
  br_id: string | null;
  br_panel_id: string | null;
  br_slot: string | null;
  br_slot_position: number | null;
  br_amperage: number | null;
  br_poles: Poles | null;
  br_label: string | null;
  br_tandem_half: 'a' | 'b' | null;
  br_panel_name: string | null;
};

/**
 * Create every table + index the app needs, idempotently, in ONE
 * multi-statement DDL script run through pg's SIMPLE query protocol
 * (`Db.exec`). Safe to run on every boot — all statements are
 * `IF NOT EXISTS` / guarded.
 *
 * Postgres porting notes vs the SQLite era:
 * - **Epoch-ms columns are `BIGINT`** (`created_at`, `tested_at`,
 *   `occurred_at`). Postgres `INTEGER` is 32-bit and `Date.now()` overflows
 *   it. `db.ts` installs a type parser so BIGINT comes back as a JS number.
 * - **`critical` is `SMALLINT`** holding 0/1 (CHECK-bounded), preserving the
 *   SQLite bool-as-int convention so `rowToComponent` stays unchanged.
 * - **Bounded ints** (slot_count, gangs, pos_x/y, x1..y2, amperage,
 *   slot_position, image/floor-plan dims, display_order) stay `INTEGER`.
 * - **Circular FK** (panels.parent_breaker_id → breakers.id while
 *   breakers.panel_id → panels.id) is resolved by creating both tables
 *   without the panels→breakers FK, then attaching it via a guarded
 *   `DO` block. The guard keys on `conrelid = 'panels'::regclass` (NOT a
 *   bare `conname` filter) so it resolves the *current schema's* panels
 *   table via search_path — essential for the schema-isolated test
 *   harness, where a bare conname filter would false-positive across
 *   parallel schemas and skip attaching the FK.
 * - **All CHECK + UNIQUE constraints are native** — no migration machinery,
 *   no PRAGMA, no `tableExists`. Postgres enforces them directly.
 *
 * Table creation order is load-bearing (FK dependencies):
 * panels → breakers → [ALTER panels FK] → floors → components → walls →
 * rooms → switch_controls → breaker_tests → service_entries → app_users.
 */
export const initSchema = async (db: Db): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS panels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      floor_plan_filename TEXT,
      image_width INTEGER,
      image_height INTEGER,
      orientation TEXT NOT NULL DEFAULT 'vertical'
        CHECK (orientation IN ('vertical','horizontal')),
      slot_count INTEGER NOT NULL DEFAULT 24
        CHECK (slot_count BETWEEN 1 AND 200),
      parent_breaker_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_panels_name ON panels(name);
    CREATE INDEX IF NOT EXISTS idx_panels_parent_breaker_id
      ON panels(parent_breaker_id);

    CREATE TABLE IF NOT EXISTS breakers (
      id TEXT PRIMARY KEY,
      panel_id TEXT NOT NULL REFERENCES panels(id),
      slot TEXT NOT NULL,
      slot_position INTEGER,
      amperage INTEGER NOT NULL,
      poles TEXT NOT NULL CHECK (poles IN ('single','double','tandem')),
      label TEXT NOT NULL,
      tandem_half TEXT CHECK (tandem_half IN ('a','b') OR tandem_half IS NULL),
      protection TEXT
        CHECK (protection IN ('gfci','afci','dual') OR protection IS NULL),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_breakers_panel_id ON breakers(panel_id);

    -- G39 cycle-56 — close the circular FK now that breakers exists. The
    -- conrelid='panels'::regclass guard makes this idempotent AND
    -- schema-safe (see initSchema JSDoc).
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'panels'::regclass
          AND conname = 'panels_parent_breaker_id_fkey'
      ) THEN
        ALTER TABLE panels
          ADD CONSTRAINT panels_parent_breaker_id_fkey
          FOREIGN KEY (parent_breaker_id)
          REFERENCES breakers(id) ON DELETE SET NULL;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INTEGER,
      floor_plan_filename TEXT,
      floor_plan_width INTEGER,
      floor_plan_height INTEGER,
      created_at BIGINT NOT NULL,
      panel_id TEXT REFERENCES panels(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_floors_name ON floors(name);
    CREATE INDEX IF NOT EXISTS idx_floors_display_order ON floors(display_order);
    CREATE INDEX IF NOT EXISTS idx_floors_panel_id ON floors(panel_id);

    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN
        ('outlet','light','switch','appliance','junction_box','smoke_detector','other')),
      name TEXT NOT NULL,
      room TEXT,
      notes TEXT,
      breaker_id TEXT REFERENCES breakers(id) ON DELETE SET NULL,
      floor_id TEXT REFERENCES floors(id) ON DELETE SET NULL,
      pos_x INTEGER,
      pos_y INTEGER,
      gangs INTEGER NOT NULL DEFAULT 1 CHECK (gangs BETWEEN 1 AND 8),
      critical SMALLINT NOT NULL DEFAULT 0 CHECK (critical IN (0,1)),
      protection TEXT
        CHECK (protection IN ('gfci','afci','dual') OR protection IS NULL),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_components_breaker_id ON components(breaker_id);
    CREATE INDEX IF NOT EXISTS idx_components_floor_id ON components(floor_id);
    CREATE INDEX IF NOT EXISTS idx_components_room ON components(room);
    CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);

    -- Coordinate bounds (BETWEEN -100000 AND 100000) MUST stay in sync with
    -- @he/shared COORD_MIN/COORD_MAX (and frontend lib/snap.ts). Constraints
    -- are explicitly NAMED *_bounds so the widening migration below is a
    -- one-shot no-op on fresh DBs. The vector editor renders through a fixed
    -- 0-10000 viewBox window; the viewport pans a much larger logical canvas
    -- underneath, so geometry legitimately lives outside 0-10000.
    CREATE TABLE IF NOT EXISTS walls (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      x1 INTEGER NOT NULL CONSTRAINT walls_x1_bounds CHECK (x1 BETWEEN -100000 AND 100000),
      y1 INTEGER NOT NULL CONSTRAINT walls_y1_bounds CHECK (y1 BETWEEN -100000 AND 100000),
      x2 INTEGER NOT NULL CONSTRAINT walls_x2_bounds CHECK (x2 BETWEEN -100000 AND 100000),
      y2 INTEGER NOT NULL CONSTRAINT walls_y2_bounds CHECK (y2 BETWEEN -100000 AND 100000),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_walls_floor_id ON walls(floor_id);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      x INTEGER NOT NULL CONSTRAINT rooms_x_bounds CHECK (x BETWEEN -100000 AND 100000),
      y INTEGER NOT NULL CONSTRAINT rooms_y_bounds CHECK (y BETWEEN -100000 AND 100000),
      w INTEGER NOT NULL CONSTRAINT rooms_w_bounds CHECK (w BETWEEN 1 AND 200000),
      h INTEGER NOT NULL CONSTRAINT rooms_h_bounds CHECK (h BETWEEN 1 AND 200000),
      -- Ordered polygon vertices [{x,y},...] (>= 3). The canonical room shape;
      -- x/y/w/h above are its bounding box, kept in sync by the repository.
      -- A rectangle room is a 4-point axis-aligned polygon; a wall-loop room
      -- is an N-point polygon. Nullable only so the additive ALTER below can
      -- backfill pre-polygon rows — the repository always writes it.
      points JSONB,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_floor_id ON rooms(floor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_rooms_floor_name
      ON rooms(floor_id, name);

    -- Polygon-room migration (2026-05). Pre-polygon DBs lack the points
    -- column + values; add it and backfill each rectangle as its 4 corners
    -- (clockwise from top-left). Idempotent: ADD COLUMN IF NOT EXISTS + the
    -- UPDATE only touches NULL rows. Fresh DBs have the column from CREATE
    -- TABLE above and the UPDATE matches nothing.
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS points JSONB;
    UPDATE rooms SET points = jsonb_build_array(
      jsonb_build_object('x', x, 'y', y),
      jsonb_build_object('x', x + w, 'y', y),
      jsonb_build_object('x', x + w, 'y', y + h),
      jsonb_build_object('x', x, 'y', y + h)
    ) WHERE points IS NULL;

    -- Coordinate-space widening migration. Pre-existing DBs carry the legacy
    -- 0..10000 CHECK constraints (auto-named <table>_<col>_check). Swap them
    -- for the wider, explicitly-named *_bounds constraints above. Guarded on
    -- the new constraint name so it runs exactly once; fresh DBs already have
    -- the *_bounds names and skip both branches. Keep bounds in sync with
    -- @he/shared COORD_MIN/COORD_MAX/ROOM_DIM_MAX.
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'walls'::regclass AND conname = 'walls_x1_bounds'
      ) THEN
        ALTER TABLE walls
          DROP CONSTRAINT IF EXISTS walls_x1_check,
          DROP CONSTRAINT IF EXISTS walls_y1_check,
          DROP CONSTRAINT IF EXISTS walls_x2_check,
          DROP CONSTRAINT IF EXISTS walls_y2_check,
          ADD CONSTRAINT walls_x1_bounds CHECK (x1 BETWEEN -100000 AND 100000),
          ADD CONSTRAINT walls_y1_bounds CHECK (y1 BETWEEN -100000 AND 100000),
          ADD CONSTRAINT walls_x2_bounds CHECK (x2 BETWEEN -100000 AND 100000),
          ADD CONSTRAINT walls_y2_bounds CHECK (y2 BETWEEN -100000 AND 100000);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'rooms'::regclass AND conname = 'rooms_x_bounds'
      ) THEN
        ALTER TABLE rooms
          DROP CONSTRAINT IF EXISTS rooms_x_check,
          DROP CONSTRAINT IF EXISTS rooms_y_check,
          DROP CONSTRAINT IF EXISTS rooms_w_check,
          DROP CONSTRAINT IF EXISTS rooms_h_check,
          ADD CONSTRAINT rooms_x_bounds CHECK (x BETWEEN -100000 AND 100000),
          ADD CONSTRAINT rooms_y_bounds CHECK (y BETWEEN -100000 AND 100000),
          ADD CONSTRAINT rooms_w_bounds CHECK (w BETWEEN 1 AND 200000),
          ADD CONSTRAINT rooms_h_bounds CHECK (h BETWEEN 1 AND 200000);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS switch_controls (
      switch_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      gang_index INTEGER NOT NULL CHECK (gang_index BETWEEN 0 AND 7),
      controlled_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      PRIMARY KEY (switch_id, gang_index, controlled_id)
    );
    CREATE INDEX IF NOT EXISTS idx_switch_controls_switch
      ON switch_controls(switch_id);
    CREATE INDEX IF NOT EXISTS idx_switch_controls_controlled
      ON switch_controls(controlled_id);

    CREATE TABLE IF NOT EXISTS breaker_tests (
      id TEXT PRIMARY KEY,
      breaker_id TEXT NOT NULL REFERENCES breakers(id) ON DELETE CASCADE,
      tested_at BIGINT NOT NULL,
      outcome TEXT,
      notes TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_breaker_tests_breaker_id_tested_at
      ON breaker_tests(breaker_id, tested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_breaker_tests_tested_at
      ON breaker_tests(tested_at DESC);

    CREATE TABLE IF NOT EXISTS service_entries (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('breaker','component')),
      parent_id TEXT NOT NULL,
      occurred_at BIGINT NOT NULL,
      note TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_service_entries_parent
      ON service_entries(parent_type, parent_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    -- ============================================================
    -- Buildings (2026-05) — top-level owner of panels/floors/components.
    -- Added AFTER those tables so the building_id columns are attached via
    -- the idempotent migration below (avoids reordering the CREATE TABLEs).
    -- A default "My House" is seeded so existing rows + fresh DBs always have
    -- at least one building. Panel/floor names are unique PER building.
    -- Keep in sync with @he/shared Building* + frontend BuildingContext.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_buildings_name ON buildings(name);

    -- Seed a default building ONLY when none exist — never resurrects a
    -- user-deleted default on a later boot.
    INSERT INTO buildings (id, name, created_at)
    SELECT 'building_default', 'My House', 0
    WHERE NOT EXISTS (SELECT 1 FROM buildings);

    -- Attach building_id to the three top-level tables (idempotent +
    -- schema-safe: 'panels'::regclass resolves via search_path). Add nullable,
    -- backfill to the oldest building, then promote NOT NULL + FK CASCADE.
    DO $$
    DECLARE def_id TEXT;
    BEGIN
      SELECT id INTO def_id FROM buildings ORDER BY created_at ASC, id ASC LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = 'panels'::regclass AND attname = 'building_id' AND NOT attisdropped) THEN
        ALTER TABLE panels ADD COLUMN building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE;
        UPDATE panels SET building_id = def_id WHERE building_id IS NULL;
        ALTER TABLE panels ALTER COLUMN building_id SET NOT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = 'floors'::regclass AND attname = 'building_id' AND NOT attisdropped) THEN
        ALTER TABLE floors ADD COLUMN building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE;
        UPDATE floors SET building_id = def_id WHERE building_id IS NULL;
        ALTER TABLE floors ALTER COLUMN building_id SET NOT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = 'components'::regclass AND attname = 'building_id' AND NOT attisdropped) THEN
        ALTER TABLE components ADD COLUMN building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE;
        UPDATE components SET building_id = def_id WHERE building_id IS NULL;
        ALTER TABLE components ALTER COLUMN building_id SET NOT NULL;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_panels_building_id ON panels(building_id);
    CREATE INDEX IF NOT EXISTS idx_floors_building_id ON floors(building_id);
    CREATE INDEX IF NOT EXISTS idx_components_building_id ON components(building_id);

    -- Swap global name-uniqueness for per-building uniqueness (once). Guard on
    -- the NEW index name scoped to the current schema (test-harness safe).
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'idx_unique_panels_building_name') THEN
        DROP INDEX IF EXISTS idx_unique_panels_name;
        CREATE UNIQUE INDEX idx_unique_panels_building_name ON panels(building_id, name);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'idx_unique_floors_building_name') THEN
        DROP INDEX IF EXISTS idx_unique_floors_name;
        CREATE UNIQUE INDEX idx_unique_floors_building_name ON floors(building_id, name);
      END IF;
    END $$;
  `);
};

/** Resolve the building id for a new row: the explicit value, or the default
 *  (oldest) building. initSchema seeds "My House", so a row always exists. */
const resolveBuildingId = async (db: Db, explicit?: string): Promise<string> => {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const row = await db.queryOne<{ id: string }>(
    'SELECT id FROM buildings ORDER BY created_at ASC, id ASC LIMIT 1'
  );
  if (row === null) {
    throw new Error('No building exists to attach this record to.');
  }
  return row.id;
};

export class PgBuildingRepository implements BuildingRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Building[]> {
    const rows = await this.db.query<{ id: string; name: string; created_at: number }>(
      'SELECT id, name, created_at FROM buildings ORDER BY created_at ASC, id ASC'
    );
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  async create(input: BuildingInput): Promise<Building> {
    const building: Building = {
      id: newId(),
      name: input.name,
      createdAt: Date.now(),
    };
    await this.db.execute(
      'INSERT INTO buildings (id, name, created_at) VALUES ($1, $2, $3)',
      [building.id, building.name, building.createdAt]
    );
    return building;
  }

  async get(id: string): Promise<Building | null> {
    const row = await this.db.queryOne<{ id: string; name: string; created_at: number }>(
      'SELECT id, name, created_at FROM buildings WHERE id = $1',
      [id]
    );
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
  }

  async update(id: string, patch: Partial<BuildingInput>): Promise<Building | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    const name = patch.name ?? existing.name;
    await this.db.execute('UPDATE buildings SET name = $1 WHERE id = $2', [name, id]);
    return { ...existing, name };
  }

  /** Cascade-delete the whole building tree in FK-safe order inside one
   *  transaction. The panels→breakers edge has no DB-level CASCADE (cascades
   *  are app-level by design — see CLAUDE.md), so a plain FK cascade from the
   *  building would fail; we delete children explicitly. */
  async delete(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Polymorphic service_entries (no FK) for this building's breakers + components.
      await tx.execute(
        `DELETE FROM service_entries WHERE
           (parent_type = 'breaker' AND parent_id IN (
              SELECT b.id FROM breakers b JOIN panels p ON b.panel_id = p.id
              WHERE p.building_id = $1))
           OR (parent_type = 'component' AND parent_id IN (
              SELECT id FROM components WHERE building_id = $1))`,
        [id]
      );
      // Components (cascades switch_controls via FK).
      await tx.execute('DELETE FROM components WHERE building_id = $1', [id]);
      // Breakers (cascades breaker_tests via FK; nulls panels.parent_breaker_id).
      await tx.execute(
        'DELETE FROM breakers WHERE panel_id IN (SELECT id FROM panels WHERE building_id = $1)',
        [id]
      );
      await tx.execute('DELETE FROM panels WHERE building_id = $1', [id]);
      // Floors (cascades walls + rooms via FK).
      await tx.execute('DELETE FROM floors WHERE building_id = $1', [id]);
      const n = await tx.execute('DELETE FROM buildings WHERE id = $1', [id]);
      return n > 0;
    });
  }
}

export class PgPanelRepository implements PanelRepository {
  constructor(private readonly db: Db) {}

  async list(filter?: { buildingId?: string }): Promise<Panel[]> {
    const scoped = filter?.buildingId !== undefined;
    const rows = await this.db.query<PanelRow>(
      `SELECT id, name, created_at, floor_plan_filename, image_width,
              image_height, orientation, slot_count, parent_breaker_id
       FROM panels ${scoped ? 'WHERE building_id = $1' : ''}
       ORDER BY created_at ASC, id ASC`,
      scoped ? [filter.buildingId] : []
    );
    return rows.map(rowToPanel);
  }

  async create(input: {
    name: string;
    orientation?: PanelOrientation;
    slotCount?: number;
    parentBreakerId?: string | null;
    buildingId?: string;
  }): Promise<Panel> {
    const buildingId = await resolveBuildingId(this.db, input.buildingId);
    const panel: Panel = {
      id: newId(),
      name: input.name,
      createdAt: Date.now(),
      floorPlan: null,
      orientation: input.orientation ?? 'vertical',
      slotCount: input.slotCount ?? 24,
      parentBreakerId: input.parentBreakerId ?? null,
    };
    await this.db.execute(
      `INSERT INTO panels (id, name, created_at, orientation, slot_count, parent_breaker_id, building_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        panel.id,
        panel.name,
        panel.createdAt,
        panel.orientation,
        panel.slotCount,
        panel.parentBreakerId,
        buildingId,
      ]
    );
    return panel;
  }

  async get(id: string): Promise<Panel | null> {
    const row = await this.db.queryOne<PanelRow>(
      `SELECT id, name, created_at, floor_plan_filename, image_width,
              image_height, orientation, slot_count, parent_breaker_id
       FROM panels WHERE id = $1`,
      [id]
    );
    return row ? rowToPanel(row) : null;
  }

  async update(id: string, patch: PanelUpdate): Promise<Panel | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    const merged: Panel = {
      ...existing,
      name: patch.name ?? existing.name,
      orientation: patch.orientation ?? existing.orientation,
      slotCount: patch.slotCount ?? existing.slotCount,
      parentBreakerId:
        patch.parentBreakerId === undefined
          ? existing.parentBreakerId
          : patch.parentBreakerId ?? null,
    };
    await this.db.execute(
      `UPDATE panels SET name = $1, orientation = $2, slot_count = $3, parent_breaker_id = $4
       WHERE id = $5`,
      [merged.name, merged.orientation, merged.slotCount, merged.parentBreakerId, id]
    );
    return merged;
  }

  /** 2026-05 — move this panel into another building, bringing the components
   *  wired to its breakers. Cross-building references are cleaned up so
   *  nothing dangles: the panel's feeder link + any subpanels it feeds are
   *  detached if they'd cross buildings, and moved components are unplaced
   *  from floors that live in a different building. Throws (FK 23503) if the
   *  target building doesn't exist — the route turns that into a 400. */
  async moveToBuilding(panelId: string, buildingId: string): Promise<Panel | null> {
    const existing = await this.get(panelId);
    if (existing === null) return null;
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE panels SET building_id = $1,
           parent_breaker_id = CASE WHEN parent_breaker_id IN (
             SELECT b.id FROM breakers b JOIN panels p ON b.panel_id = p.id
             WHERE p.building_id = $1
           ) THEN parent_breaker_id ELSE NULL END
         WHERE id = $2`,
        [buildingId, panelId]
      );
      await tx.execute(
        `UPDATE panels SET parent_breaker_id = NULL
         WHERE building_id <> $1
           AND parent_breaker_id IN (SELECT id FROM breakers WHERE panel_id = $2)`,
        [buildingId, panelId]
      );
      await tx.execute(
        `UPDATE components SET building_id = $1,
           floor_id = CASE WHEN floor_id IN (SELECT id FROM floors WHERE building_id = $1)
             THEN floor_id ELSE NULL END
         WHERE breaker_id IN (SELECT id FROM breakers WHERE panel_id = $2)`,
        [buildingId, panelId]
      );
    });
    return this.get(panelId);
  }

  async setFloorPlan(panelId: string, plan: FloorPlan): Promise<Panel | null> {
    const n = await this.db.execute(
      `UPDATE panels SET floor_plan_filename = $1, image_width = $2, image_height = $3
       WHERE id = $4`,
      [plan.filename, plan.width, plan.height, panelId]
    );
    if (n === 0) return null;
    return this.get(panelId);
  }

  async clearFloorPlan(panelId: string): Promise<Panel | null> {
    const n = await this.db.execute(
      `UPDATE panels SET floor_plan_filename = NULL, image_width = NULL, image_height = NULL
       WHERE id = $1`,
      [panelId]
    );
    if (n === 0) return null;
    return this.get(panelId);
  }

  async delete(id: string): Promise<boolean> {
    // Iterate this panel's breakers so the component-null cascade composes
    // inside ONE transaction (dedicated client). breaker_tests cascade via
    // their FK ON DELETE CASCADE when each breaker is dropped — no explicit
    // delete needed here (mirrors the SQLite-era behavior).
    return this.db.transaction(async (tx) => {
      const breakerRows = await tx.query<{ id: string }>(
        'SELECT id FROM breakers WHERE panel_id = $1',
        [id]
      );
      // Cycle-85 — belt-and-suspenders: floors.panel_id ON DELETE SET NULL is
      // the DB-level invariant; this UPDATE is greppable and survives a future
      // migration that forgets the FK clause.
      await tx.execute('UPDATE floors SET panel_id = NULL WHERE panel_id = $1', [id]);
      for (const { id: breakerId } of breakerRows) {
        await tx.execute(
          'UPDATE components SET breaker_id = NULL WHERE breaker_id = $1',
          [breakerId]
        );
        // G39 cycle-56 — detach any subpanel fed by this breaker.
        await tx.execute(
          'UPDATE panels SET parent_breaker_id = NULL WHERE parent_breaker_id = $1',
          [breakerId]
        );
        // G40 cycle-66 — service_entries (breaker-parent) cascade. No FK
        // (polymorphic), so this APP-LEVEL DELETE is THE invariant.
        await tx.execute(
          `DELETE FROM service_entries WHERE parent_type = 'breaker' AND parent_id = $1`,
          [breakerId]
        );
        await tx.execute('DELETE FROM breakers WHERE id = $1', [breakerId]);
      }
      const n = await tx.execute('DELETE FROM panels WHERE id = $1', [id]);
      return n > 0;
    });
  }
}

export class PgBreakerRepository implements BreakerRepository {
  constructor(private readonly db: Db) {}

  async listByPanel(panelId: string): Promise<Breaker[]> {
    // `slot_position IS NULL` is a boolean sort key: FALSE (slotted) sorts
    // before TRUE (unslotted) under ASC, matching the SQLite behavior. The
    // explicit `tandem_half ASC NULLS FIRST` restores SQLite's default
    // NULLS-FIRST ordering (Postgres defaults to NULLS LAST for ASC).
    const rows = await this.db.query<BreakerRow>(
      `SELECT id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at
       FROM breakers
       WHERE panel_id = $1
       ORDER BY (slot_position IS NULL), slot_position ASC, tandem_half ASC NULLS FIRST, slot ASC`,
      [panelId]
    );
    return rows.map(rowToBreaker);
  }

  async create(panelId: string, input: BreakerInput): Promise<Breaker> {
    // G34: non-tandem breakers always have tandemHalf=null; tandem ones
    // must have 'a' or 'b' (the route's validateSlotAssignment enforces).
    const tandemHalf =
      input.poles === 'tandem' ? input.tandemHalf ?? null : null;
    const breaker: Breaker = {
      id: newId(),
      panelId,
      slot: input.slot,
      slotPosition: input.slotPosition ?? null,
      amperage: input.amperage,
      poles: input.poles,
      label: input.label,
      tandemHalf,
      protection: input.protection ?? null,
      createdAt: Date.now(),
    };
    await this.db.execute(
      `INSERT INTO breakers (id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        breaker.id,
        breaker.panelId,
        breaker.slot,
        breaker.slotPosition,
        breaker.amperage,
        breaker.poles,
        breaker.label,
        breaker.tandemHalf,
        breaker.protection,
        breaker.createdAt,
      ]
    );
    return breaker;
  }

  async get(id: string): Promise<Breaker | null> {
    const row = await this.db.queryOne<BreakerRow>(
      `SELECT id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at
       FROM breakers WHERE id = $1`,
      [id]
    );
    return row ? rowToBreaker(row) : null;
  }

  async update(id: string, patch: Partial<BreakerInput>): Promise<Breaker | null> {
    const existing = await this.get(id);
    if (existing === null) return null;

    const nextPoles = patch.poles ?? existing.poles;
    // G34: if poles transitions to non-tandem, force tandemHalf=null.
    // If poles stays tandem AND patch.tandemHalf is undefined, keep existing.
    // Otherwise use patch.tandemHalf (which can be 'a' | 'b' | null).
    const nextTandemHalf: 'a' | 'b' | null =
      nextPoles !== 'tandem'
        ? null
        : patch.tandemHalf === undefined
          ? existing.tandemHalf
          : patch.tandemHalf ?? null;

    const merged: Breaker = {
      ...existing,
      slot: patch.slot ?? existing.slot,
      slotPosition:
        patch.slotPosition === undefined ? existing.slotPosition : patch.slotPosition ?? null,
      amperage: patch.amperage ?? existing.amperage,
      poles: nextPoles,
      label: patch.label ?? existing.label,
      tandemHalf: nextTandemHalf,
      protection:
        patch.protection === undefined ? existing.protection : patch.protection ?? null,
    };

    await this.db.execute(
      `UPDATE breakers
       SET slot = $1, slot_position = $2, amperage = $3, poles = $4, label = $5, tandem_half = $6, protection = $7
       WHERE id = $8`,
      [
        merged.slot,
        merged.slotPosition,
        merged.amperage,
        merged.poles,
        merged.label,
        merged.tandemHalf,
        merged.protection,
        id,
      ]
    );

    return merged;
  }

  async delete(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        'UPDATE components SET breaker_id = NULL WHERE breaker_id = $1',
        [id]
      );
      // G39 cycle-56 — belt-and-suspenders detach of any subpanel fed by this
      // breaker (the FK ON DELETE SET NULL is the DB-level invariant).
      await tx.execute(
        'UPDATE panels SET parent_breaker_id = NULL WHERE parent_breaker_id = $1',
        [id]
      );
      // G36 cycle-61 — belt-and-suspenders audit-trail cascade. The FK
      // ON DELETE CASCADE is the DB-level invariant; this DELETE is greppable
      // and survives a future migration that forgets the FK clause.
      await tx.execute('DELETE FROM breaker_tests WHERE breaker_id = $1', [id]);
      // G40 cycle-66 — service_entries has no FK (polymorphic). Cascade is
      // APP-LEVEL only; this is THE invariant.
      await tx.execute(
        `DELETE FROM service_entries WHERE parent_type = 'breaker' AND parent_id = $1`,
        [id]
      );
      const n = await tx.execute('DELETE FROM breakers WHERE id = $1', [id]);
      return n > 0;
    });
  }

  async deleteByPanel(panelId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // G39 cycle-56 — detach every subpanel fed by a breaker on this panel
      // before bulk-deleting them, so child subpanels survive.
      await tx.execute(
        `UPDATE panels SET parent_breaker_id = NULL
         WHERE parent_breaker_id IN (SELECT id FROM breakers WHERE panel_id = $1)`,
        [panelId]
      );
      // G36 cycle-61 — belt-and-suspenders audit-trail cascade for bulk delete.
      await tx.execute(
        `DELETE FROM breaker_tests
         WHERE breaker_id IN (SELECT id FROM breakers WHERE panel_id = $1)`,
        [panelId]
      );
      // G40 cycle-66 — service_entries (breaker-parent) cascade for bulk delete.
      await tx.execute(
        `DELETE FROM service_entries
         WHERE parent_type = 'breaker'
           AND parent_id IN (SELECT id FROM breakers WHERE panel_id = $1)`,
        [panelId]
      );
      await tx.execute('DELETE FROM breakers WHERE panel_id = $1', [panelId]);
    });
  }
}

export class PgComponentRepository implements ComponentRepository {
  constructor(private readonly db: Db) {}

  async list(filter?: ComponentListFilter): Promise<ResolvedComponent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const ph = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filter?.room !== undefined) {
      where.push(`c.room = ${ph(filter.room)}`);
    }
    if (filter?.type !== undefined) {
      where.push(`c.type = ${ph(filter.type)}`);
    }
    if (filter?.breakerId !== undefined) {
      where.push(`c.breaker_id = ${ph(filter.breakerId)}`);
    }
    if (filter?.floorId !== undefined) {
      where.push(`c.floor_id = ${ph(filter.floorId)}`);
    }
    if (filter?.buildingId !== undefined) {
      where.push(`c.building_id = ${ph(filter.buildingId)}`);
    }
    if (filter?.search !== undefined) {
      // G40 Part 2 (cycle-67): search ALSO matches service_entries.note
      // content. The EXISTS subquery avoids row duplication (vs a LEFT JOIN
      // which would multiply rows by matching log entries) — a single
      // component matches ONCE even if it has multiple matching log entries.
      // Sort order unchanged ("search filters, never reorders").
      const like = `%${filter.search}%`;
      where.push(
        `(LOWER(c.name) LIKE LOWER(${ph(like)})
          OR (c.room IS NOT NULL AND LOWER(c.room) LIKE LOWER(${ph(like)}))
          OR EXISTS (
            SELECT 1 FROM service_entries
            WHERE service_entries.parent_type = 'component'
              AND service_entries.parent_id = c.id
              AND LOWER(service_entries.note) LIKE LOWER(${ph(like)})
          ))`
      );
    }
    const sql = `SELECT
        c.id, c.type, c.name, c.room, c.notes, c.breaker_id, c.floor_id, c.pos_x, c.pos_y, c.gangs, c.critical, c.protection, c.created_at,
        b.id   AS br_id,
        b.panel_id AS br_panel_id,
        b.slot AS br_slot,
        b.slot_position AS br_slot_position,
        b.amperage AS br_amperage,
        b.poles AS br_poles,
        b.label AS br_label,
        b.tandem_half AS br_tandem_half,
        p.name AS br_panel_name
      FROM components c
      LEFT JOIN breakers b ON c.breaker_id = b.id
      LEFT JOIN panels p ON b.panel_id = p.id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at ASC, c.id ASC`;
    const rows = await this.db.query<ResolvedComponentRow>(sql, params);
    return rows.map(rowToResolvedComponent);
  }

  async create(input: ComponentInput): Promise<Component> {
    const buildingId = await resolveBuildingId(this.db, input.buildingId);
    const component: Component = {
      id: newId(),
      type: input.type,
      name: input.name,
      room: input.room ?? null,
      notes: input.notes ?? null,
      critical: input.critical ?? false,
      breakerId: input.breakerId ?? null,
      floorId: input.floorId ?? null,
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      gangs: input.gangs ?? 1,
      protection: input.protection ?? null,
      createdAt: Date.now(),
    };
    await this.db.execute(
      `INSERT INTO components (id, type, name, room, notes, breaker_id, floor_id, pos_x, pos_y, gangs, critical, protection, created_at, building_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        component.id,
        component.type,
        component.name,
        component.room,
        component.notes,
        component.breakerId,
        component.floorId,
        component.posX,
        component.posY,
        component.gangs,
        component.critical ? 1 : 0,
        component.protection,
        component.createdAt,
        buildingId,
      ]
    );
    return component;
  }

  async get(id: string): Promise<ResolvedComponent | null> {
    const row = await this.db.queryOne<ResolvedComponentRow>(
      `SELECT
         c.id, c.type, c.name, c.room, c.notes, c.breaker_id, c.floor_id, c.pos_x, c.pos_y, c.gangs, c.critical, c.protection, c.created_at,
         b.id   AS br_id,
         b.panel_id AS br_panel_id,
         b.slot AS br_slot,
         b.slot_position AS br_slot_position,
         b.amperage AS br_amperage,
         b.poles AS br_poles,
         b.label AS br_label,
         b.tandem_half AS br_tandem_half,
         b.protection AS br_protection,
         p.name AS br_panel_name
       FROM components c
       LEFT JOIN breakers b ON c.breaker_id = b.id
       LEFT JOIN panels p ON b.panel_id = p.id
       WHERE c.id = $1`,
      [id]
    );
    return row ? rowToResolvedComponent(row) : null;
  }

  async update(id: string, patch: Partial<ComponentInput>): Promise<Component | null> {
    const existing = await this.get(id);
    if (existing === null) return null;

    const merged: Component = {
      id: existing.id,
      createdAt: existing.createdAt,
      type: patch.type ?? existing.type,
      name: patch.name ?? existing.name,
      room: patch.room === undefined ? existing.room : patch.room ?? null,
      notes: patch.notes === undefined ? existing.notes : patch.notes ?? null,
      critical: patch.critical === undefined ? existing.critical : patch.critical,
      breakerId:
        patch.breakerId === undefined ? existing.breakerId : patch.breakerId ?? null,
      floorId:
        patch.floorId === undefined ? existing.floorId : patch.floorId ?? null,
      posX: patch.posX === undefined ? existing.posX : patch.posX ?? null,
      posY: patch.posY === undefined ? existing.posY : patch.posY ?? null,
      gangs: patch.gangs ?? existing.gangs,
      protection:
        patch.protection === undefined ? existing.protection : patch.protection ?? null,
    };

    // Refactor 2026-05 follow-up — switch+controlled share one circuit.
    // When a switch's breakerId is being patched, propagate the new breakerId
    // to every component the switch controls. Electrical reality: the switch
    // is on the same circuit as the load it controls. ALWAYS propagates —
    // including null → null — so the invariant "switch.breakerId === every
    // controlled.breakerId" holds. Wrapped in a transaction so a propagation
    // failure leaves the switch unchanged.
    const propagateBreaker =
      merged.type === 'switch' &&
      patch.breakerId !== undefined &&
      merged.breakerId !== existing.breakerId;

    await this.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE components
         SET type = $1, name = $2, room = $3, notes = $4, breaker_id = $5, floor_id = $6, pos_x = $7, pos_y = $8, gangs = $9, critical = $10, protection = $11
         WHERE id = $12`,
        [
          merged.type,
          merged.name,
          merged.room,
          merged.notes,
          merged.breakerId,
          merged.floorId,
          merged.posX,
          merged.posY,
          merged.gangs,
          merged.critical ? 1 : 0,
          merged.protection,
          id,
        ]
      );

      if (propagateBreaker) {
        const rows = await tx.query<{ controlled_id: string }>(
          'SELECT controlled_id FROM switch_controls WHERE switch_id = $1',
          [id]
        );
        for (const r of rows) {
          await tx.execute('UPDATE components SET breaker_id = $1 WHERE id = $2', [
            merged.breakerId,
            r.controlled_id,
          ]);
        }
      }
    });

    return merged;
  }

  async delete(id: string): Promise<boolean> {
    // G40 cycle-66 — belt-and-suspenders cascade of service_entries with
    // parent_type='component'. No FK (polymorphic), so this APP-LEVEL DELETE
    // is THE invariant. Wrapped in a transaction so a failure leaves the
    // component intact.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        `DELETE FROM service_entries WHERE parent_type = 'component' AND parent_id = $1`,
        [id]
      );
      const n = await tx.execute('DELETE FROM components WHERE id = $1', [id]);
      return n > 0;
    });
  }
}

const rowToPanel = (row: PanelRow): Panel => {
  const floorPlan: FloorPlan | null =
    row.floor_plan_filename !== null &&
    row.image_width !== null &&
    row.image_height !== null
      ? {
          filename: row.floor_plan_filename,
          width: row.image_width,
          height: row.image_height,
        }
      : null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    floorPlan,
    orientation: row.orientation,
    slotCount: row.slot_count,
    parentBreakerId: row.parent_breaker_id,
  };
};

const rowToBreaker = (row: BreakerRow): Breaker => ({
  id: row.id,
  panelId: row.panel_id,
  slot: row.slot,
  slotPosition: row.slot_position,
  amperage: row.amperage,
  poles: row.poles,
  label: row.label,
  tandemHalf: row.tandem_half,
  protection: row.protection,
  createdAt: row.created_at,
});

const rowToComponent = (row: ComponentRow): Component => ({
  id: row.id,
  type: row.type,
  name: row.name,
  room: row.room,
  notes: row.notes,
  critical: row.critical === 1,
  breakerId: row.breaker_id,
  floorId: row.floor_id,
  posX: row.pos_x,
  posY: row.pos_y,
  gangs: row.gangs,
  protection: row.protection,
  createdAt: row.created_at,
});

const rowToResolvedComponent = (row: ResolvedComponentRow): ResolvedComponent => {
  const component: Component = rowToComponent(row);
  const breaker =
    row.br_id !== null &&
    row.br_panel_id !== null &&
    row.br_panel_name !== null &&
    row.br_slot !== null &&
    row.br_amperage !== null &&
    row.br_poles !== null &&
    row.br_label !== null
      ? {
          id: row.br_id,
          panelId: row.br_panel_id,
          panelName: row.br_panel_name,
          slot: row.br_slot,
          slotPosition: row.br_slot_position,
          amperage: row.br_amperage,
          poles: row.br_poles,
          label: row.br_label,
          tandemHalf: row.br_tandem_half,
        }
      : null;
  return { ...component, breaker };
};

// === Floors (G13) ===

const rowToFloor = (row: FloorRow): Floor => ({
  id: row.id,
  name: row.name,
  displayOrder: row.display_order,
  createdAt: row.created_at,
  floorPlan:
    row.floor_plan_filename !== null &&
    row.floor_plan_width !== null &&
    row.floor_plan_height !== null
      ? {
          filename: row.floor_plan_filename,
          width: row.floor_plan_width,
          height: row.floor_plan_height,
        }
      : null,
  // Cycle-85 — linked panel for default-wiring.
  panelId: row.panel_id,
});

const FLOOR_COLS =
  'id, name, display_order, floor_plan_filename, floor_plan_width, floor_plan_height, created_at, panel_id';
const FLOOR_SORT =
  '(display_order IS NULL), display_order ASC, created_at ASC, id ASC';

export class PgFloorRepository implements FloorRepository {
  constructor(private readonly db: Db) {}

  async list(filter?: { buildingId?: string }): Promise<Floor[]> {
    const scoped = filter?.buildingId !== undefined;
    const rows = await this.db.query<FloorRow>(
      `SELECT ${FLOOR_COLS} FROM floors ${scoped ? 'WHERE building_id = $1' : ''}
       ORDER BY ${FLOOR_SORT}`,
      scoped ? [filter.buildingId] : []
    );
    return rows.map(rowToFloor);
  }

  async create(input: FloorInput): Promise<Floor> {
    const buildingId = await resolveBuildingId(this.db, input.buildingId);
    const floor: Floor = {
      id: newId(),
      name: input.name,
      displayOrder: input.displayOrder ?? null,
      createdAt: Date.now(),
      floorPlan: null,
      panelId: input.panelId ?? null,
    };
    await this.db.execute(
      'INSERT INTO floors (id, name, display_order, created_at, panel_id, building_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [floor.id, floor.name, floor.displayOrder, floor.createdAt, floor.panelId, buildingId]
    );
    return floor;
  }

  async get(id: string): Promise<Floor | null> {
    const row = await this.db.queryOne<FloorRow>(
      `SELECT ${FLOOR_COLS} FROM floors WHERE id = $1`,
      [id]
    );
    return row ? rowToFloor(row) : null;
  }

  async update(id: string, patch: Partial<FloorInput>): Promise<Floor | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    const merged: Floor = {
      ...existing,
      name: patch.name ?? existing.name,
      displayOrder:
        patch.displayOrder === undefined
          ? existing.displayOrder
          : patch.displayOrder ?? null,
      // Cycle-85 — panelId. undefined = leave alone; null = explicit clear.
      panelId:
        patch.panelId === undefined ? existing.panelId : patch.panelId ?? null,
    };
    await this.db.execute(
      'UPDATE floors SET name = $1, display_order = $2, panel_id = $3 WHERE id = $4',
      [merged.name, merged.displayOrder, merged.panelId, id]
    );
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    // Cascade: NULL out any components pointing at this floor BEFORE deleting
    // it (components.floor_id is ON DELETE SET NULL; this is belt-and-
    // suspenders). walls + rooms cascade via their FK ON DELETE CASCADE.
    return this.db.transaction(async (tx) => {
      await tx.execute('UPDATE components SET floor_id = NULL WHERE floor_id = $1', [id]);
      const n = await tx.execute('DELETE FROM floors WHERE id = $1', [id]);
      return n > 0;
    });
  }

  /** 2026-05 — move this floor into another building, bringing the components
   *  placed on it (walls + rooms follow automatically via floor_id). The
   *  floor's default-panel link is detached if it crosses buildings, and
   *  moved components are unwired from breakers in a different building.
   *  Throws (FK 23503) if the target building doesn't exist. */
  async moveToBuilding(floorId: string, buildingId: string): Promise<Floor | null> {
    const existing = await this.get(floorId);
    if (existing === null) return null;
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE floors SET building_id = $1,
           panel_id = CASE WHEN panel_id IN (SELECT id FROM panels WHERE building_id = $1)
             THEN panel_id ELSE NULL END
         WHERE id = $2`,
        [buildingId, floorId]
      );
      await tx.execute(
        `UPDATE components SET building_id = $1,
           breaker_id = CASE WHEN breaker_id IN (
             SELECT b.id FROM breakers b JOIN panels p ON b.panel_id = p.id
             WHERE p.building_id = $1
           ) THEN breaker_id ELSE NULL END
         WHERE floor_id = $2`,
        [buildingId, floorId]
      );
    });
    return this.get(floorId);
  }

  async setFloorPlan(floorId: string, plan: FloorPlan): Promise<Floor | null> {
    const n = await this.db.execute(
      'UPDATE floors SET floor_plan_filename = $1, floor_plan_width = $2, floor_plan_height = $3 WHERE id = $4',
      [plan.filename, plan.width, plan.height, floorId]
    );
    if (n === 0) return null;
    return this.get(floorId);
  }

  async clearFloorPlan(floorId: string): Promise<Floor | null> {
    const n = await this.db.execute(
      'UPDATE floors SET floor_plan_filename = NULL, floor_plan_width = NULL, floor_plan_height = NULL WHERE id = $1',
      [floorId]
    );
    if (n === 0) return null;
    return this.get(floorId);
  }
}

// === Walls (G12) ===

type WallRow = {
  id: string;
  floor_id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  created_at: number;
};

const rowToWall = (row: WallRow): Wall => ({
  id: row.id,
  floorId: row.floor_id,
  x1: row.x1,
  y1: row.y1,
  x2: row.x2,
  y2: row.y2,
  createdAt: row.created_at,
});

const WALL_COLS = 'id, floor_id, x1, y1, x2, y2, created_at';

export class PgWallRepository implements WallRepository {
  constructor(private readonly db: Db) {}

  async listByFloor(floorId: string): Promise<Wall[]> {
    const rows = await this.db.query<WallRow>(
      `SELECT ${WALL_COLS} FROM walls WHERE floor_id = $1
       ORDER BY created_at ASC, id ASC`,
      [floorId]
    );
    return rows.map(rowToWall);
  }

  async create(floorId: string, input: WallInput): Promise<Wall> {
    const wall: Wall = {
      id: newId(),
      floorId,
      x1: input.x1,
      y1: input.y1,
      x2: input.x2,
      y2: input.y2,
      createdAt: Date.now(),
    };
    await this.db.execute(
      `INSERT INTO walls (id, floor_id, x1, y1, x2, y2, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [wall.id, wall.floorId, wall.x1, wall.y1, wall.x2, wall.y2, wall.createdAt]
    );
    return wall;
  }

  async get(id: string): Promise<Wall | null> {
    const row = await this.db.queryOne<WallRow>(
      `SELECT ${WALL_COLS} FROM walls WHERE id = $1`,
      [id]
    );
    return row ? rowToWall(row) : null;
  }

  async update(id: string, patch: Partial<WallInput>): Promise<Wall | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    const merged: Wall = {
      ...existing,
      x1: patch.x1 ?? existing.x1,
      y1: patch.y1 ?? existing.y1,
      x2: patch.x2 ?? existing.x2,
      y2: patch.y2 ?? existing.y2,
    };
    await this.db.execute(
      'UPDATE walls SET x1 = $1, y1 = $2, x2 = $3, y2 = $4 WHERE id = $5',
      [merged.x1, merged.y1, merged.x2, merged.y2, id]
    );
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const n = await this.db.execute('DELETE FROM walls WHERE id = $1', [id]);
    return n > 0;
  }
}

// === Rooms (G12) ===

type RoomRow = {
  id: string;
  floor_id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** pg parses JSONB to a JS value, so this is already an array (or null
   *  on a pre-migration row the backfill somehow missed). */
  points: RoomVertex[] | null;
  created_at: number;
};

const rowToRoom = (row: RoomRow): Room => ({
  id: row.id,
  floorId: row.floor_id,
  name: row.name,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  // Defensive fallback: derive a rectangle polygon if points is somehow null.
  points: row.points ?? rectToPolygon(row.x, row.y, row.w, row.h),
  createdAt: row.created_at,
});

const ROOM_COLS = 'id, floor_id, name, x, y, w, h, points, created_at';

/** Normalize a RoomInput shape into BOTH representations the table stores:
 *  the canonical polygon `points` + its axis-aligned bounding box. Accepts
 *  either a polygon (`points`) or a rectangle (`x/y/w/h`). */
const normalizeRoomShape = (
  shape: Pick<RoomInput, 'x' | 'y' | 'w' | 'h' | 'points'>
): { x: number; y: number; w: number; h: number; points: RoomVertex[] } => {
  if (shape.points !== undefined) {
    const bounds = polygonBounds(shape.points);
    return { ...bounds, points: shape.points };
  }
  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const w = shape.w ?? 1;
  const h = shape.h ?? 1;
  return { x, y, w, h, points: rectToPolygon(x, y, w, h) };
};

export class PgRoomRepository implements RoomRepository {
  constructor(private readonly db: Db) {}

  async listByFloor(floorId: string): Promise<Room[]> {
    const rows = await this.db.query<RoomRow>(
      `SELECT ${ROOM_COLS} FROM rooms WHERE floor_id = $1
       ORDER BY created_at ASC, id ASC`,
      [floorId]
    );
    return rows.map(rowToRoom);
  }

  async listAll(): Promise<Room[]> {
    // Cycle-85 — flat house-level read for ComponentForm Room datalist.
    const rows = await this.db.query<RoomRow>(
      `SELECT ${ROOM_COLS} FROM rooms ORDER BY created_at ASC, id ASC`
    );
    return rows.map(rowToRoom);
  }

  async create(floorId: string, input: RoomInput): Promise<Room> {
    const shape = normalizeRoomShape(input);
    const room: Room = {
      id: newId(),
      floorId,
      name: input.name,
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      points: shape.points,
      createdAt: Date.now(),
    };
    await this.db.execute(
      `INSERT INTO rooms (id, floor_id, name, x, y, w, h, points, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        room.id,
        room.floorId,
        room.name,
        room.x,
        room.y,
        room.w,
        room.h,
        JSON.stringify(room.points),
        room.createdAt,
      ]
    );
    return room;
  }

  async get(id: string): Promise<Room | null> {
    const row = await this.db.queryOne<RoomRow>(
      `SELECT ${ROOM_COLS} FROM rooms WHERE id = $1`,
      [id]
    );
    return row ? rowToRoom(row) : null;
  }

  async update(id: string, patch: Partial<RoomInput>): Promise<Room | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    // Resolve the new shape: a `points` patch wins (polygon reshape); else an
    // x/y/w/h patch rebuilds the rectangle (legacy resize/translate); else the
    // shape is untouched (e.g. a name-only patch). SQL never touches floor_id
    // — rooms don't migrate between floors.
    let shape: { x: number; y: number; w: number; h: number; points: RoomVertex[] };
    if (patch.points !== undefined) {
      shape = normalizeRoomShape({ points: patch.points });
    } else if (
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.w !== undefined ||
      patch.h !== undefined
    ) {
      shape = normalizeRoomShape({
        x: patch.x ?? existing.x,
        y: patch.y ?? existing.y,
        w: patch.w ?? existing.w,
        h: patch.h ?? existing.h,
      });
    } else {
      shape = {
        x: existing.x,
        y: existing.y,
        w: existing.w,
        h: existing.h,
        points: existing.points,
      };
    }
    const merged: Room = {
      ...existing,
      name: patch.name ?? existing.name,
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      points: shape.points,
    };
    await this.db.execute(
      'UPDATE rooms SET name = $1, x = $2, y = $3, w = $4, h = $5, points = $6::jsonb WHERE id = $7',
      [
        merged.name,
        merged.x,
        merged.y,
        merged.w,
        merged.h,
        JSON.stringify(merged.points),
        id,
      ]
    );
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const n = await this.db.execute('DELETE FROM rooms WHERE id = $1', [id]);
    return n > 0;
  }
}

// === Breaker tests (G36 cycle-61 — audit trail) ===

type BreakerTestRow = {
  id: string;
  breaker_id: string;
  tested_at: number;
  outcome: string | null;
  notes: string | null;
  created_at: number;
};

const rowToBreakerTest = (row: BreakerTestRow): BreakerTest => ({
  id: row.id,
  breakerId: row.breaker_id,
  testedAt: row.tested_at,
  outcome: row.outcome,
  notes: row.notes,
  createdAt: row.created_at,
});

const BREAKER_TEST_COLS =
  'id, breaker_id, tested_at, outcome, notes, created_at';

export class PgBreakerTestRepository implements BreakerTestRepository {
  constructor(private readonly db: Db) {}

  async list(filter?: BreakerTestListFilter): Promise<BreakerTestListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    const ph = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filter?.breakerId !== undefined) {
      where.push(`breaker_id = ${ph(filter.breakerId)}`);
    }
    if (filter?.since !== undefined) {
      where.push(`tested_at >= ${ph(filter.since)}`);
    }
    if (filter?.until !== undefined) {
      where.push(`tested_at <= ${ph(filter.until)}`);
    }
    if (filter?.outcome !== undefined) {
      where.push(`outcome = ${ph(filter.outcome)}`);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // G36 Part 2 (cycle-63) — totalCount is the WHERE-filtered count BEFORE
    // the LIMIT is applied, so the UI can render "Showing N of M". Snapshot
    // the WHERE params before the LIMIT placeholder is appended below.
    const countParams = [...params];
    const totalRow = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM breaker_tests ${whereClause}`,
      countParams
    );
    const totalCount = totalRow?.count ?? 0;

    let sql = `SELECT ${BREAKER_TEST_COLS} FROM breaker_tests
      ${whereClause}
      ORDER BY tested_at DESC, id DESC`;
    if (filter?.limit !== undefined) {
      sql += ` LIMIT ${ph(filter.limit)}`;
    }
    const rows = await this.db.query<BreakerTestRow>(sql, params);
    return { data: rows.map(rowToBreakerTest), totalCount };
  }

  async create(input: BreakerTestInput): Promise<BreakerTest> {
    const now = Date.now();
    const test: BreakerTest = {
      id: newId(),
      breakerId: input.breakerId,
      testedAt: input.testedAt ?? now,
      outcome: input.outcome ?? null,
      notes: input.notes ?? null,
      createdAt: now,
    };
    await this.db.execute(
      `INSERT INTO breaker_tests (${BREAKER_TEST_COLS})
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [test.id, test.breakerId, test.testedAt, test.outcome, test.notes, test.createdAt]
    );
    return test;
  }

  async delete(id: string): Promise<boolean> {
    const n = await this.db.execute('DELETE FROM breaker_tests WHERE id = $1', [id]);
    return n > 0;
  }

  async latestByBreaker(
    breakerIds: readonly string[]
  ): Promise<Map<string, BreakerTest | null>> {
    const out = new Map<string, BreakerTest | null>();
    for (const id of breakerIds) out.set(id, null);
    if (breakerIds.length === 0) return out;
    // For each breakerId, fetch the single most-recent row. The composite
    // index (breaker_id, tested_at DESC) makes this O(log n) per breaker.
    for (const id of breakerIds) {
      const row = await this.db.queryOne<BreakerTestRow>(
        `SELECT ${BREAKER_TEST_COLS} FROM breaker_tests
         WHERE breaker_id = $1
         ORDER BY tested_at DESC, id DESC
         LIMIT 1`,
        [id]
      );
      out.set(id, row ? rowToBreakerTest(row) : null);
    }
    return out;
  }
}

// === Service entries (G40 Part 1 cycle-66 — dated service-log) ===

type ServiceEntryRow = {
  id: string;
  parent_type: ServiceEntryParentType;
  parent_id: string;
  occurred_at: number;
  note: string;
  created_at: number;
};

const rowToServiceEntry = (row: ServiceEntryRow): ServiceEntry => ({
  id: row.id,
  parentType: row.parent_type,
  parentId: row.parent_id,
  occurredAt: row.occurred_at,
  note: row.note,
  createdAt: row.created_at,
});

const SERVICE_ENTRY_COLS =
  'id, parent_type, parent_id, occurred_at, note, created_at';

export class PgServiceEntryRepository implements ServiceEntryRepository {
  constructor(private readonly db: Db) {}

  async list(
    filter?: ServiceEntryListFilter
  ): Promise<ServiceEntryListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    const ph = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filter?.parentType !== undefined) {
      where.push(`parent_type = ${ph(filter.parentType)}`);
    }
    if (filter?.parentId !== undefined) {
      where.push(`parent_id = ${ph(filter.parentId)}`);
    }
    if (filter?.parentIds !== undefined && filter.parentIds.length > 0) {
      const placeholders = filter.parentIds.map((pid) => ph(pid)).join(',');
      where.push(`parent_id IN (${placeholders})`);
    }
    if (filter?.since !== undefined) {
      where.push(`occurred_at >= ${ph(filter.since)}`);
    }
    if (filter?.until !== undefined) {
      where.push(`occurred_at <= ${ph(filter.until)}`);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countParams = [...params];
    const totalRow = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM service_entries ${whereClause}`,
      countParams
    );
    const totalCount = totalRow?.count ?? 0;

    let sql = `SELECT ${SERVICE_ENTRY_COLS} FROM service_entries
      ${whereClause}
      ORDER BY occurred_at DESC, id DESC`;
    if (filter?.limit !== undefined) {
      sql += ` LIMIT ${ph(filter.limit)}`;
    }
    const rows = await this.db.query<ServiceEntryRow>(sql, params);
    return { data: rows.map(rowToServiceEntry), totalCount };
  }

  async create(input: {
    parentType: ServiceEntryParentType;
    parentId: string;
    occurredAt?: number;
    note: string;
  }): Promise<ServiceEntry> {
    const now = Date.now();
    const entry: ServiceEntry = {
      id: newId(),
      parentType: input.parentType,
      parentId: input.parentId,
      occurredAt: input.occurredAt ?? now,
      note: input.note,
      createdAt: now,
    };
    await this.db.execute(
      `INSERT INTO service_entries (${SERVICE_ENTRY_COLS})
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.id,
        entry.parentType,
        entry.parentId,
        entry.occurredAt,
        entry.note,
        entry.createdAt,
      ]
    );
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const n = await this.db.execute('DELETE FROM service_entries WHERE id = $1', [id]);
    return n > 0;
  }
}

// ── PgAppUserRepository (single-user login sign-up flow) ──────────────────

type AppUserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: number;
};

const rowToAppUser = (row: AppUserRow): AppUser => ({
  id: row.id,
  username: row.username,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

export class PgAppUserRepository implements AppUserRepository {
  constructor(private readonly db: Db) {}

  async hasAnyUser(): Promise<boolean> {
    const row = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM app_users'
    );
    return (row?.n ?? 0) > 0;
  }

  async getSingle(): Promise<AppUser | null> {
    const row = await this.db.queryOne<AppUserRow>(
      'SELECT id, username, password_hash, created_at FROM app_users LIMIT 1'
    );
    return row === null ? null : rowToAppUser(row);
  }

  async getByUsername(username: string): Promise<AppUser | null> {
    const row = await this.db.queryOne<AppUserRow>(
      'SELECT id, username, password_hash, created_at FROM app_users WHERE username = $1',
      [username]
    );
    return row === null ? null : rowToAppUser(row);
  }

  async create(input: { username: string; passwordHash: string }): Promise<AppUser> {
    // Wrap the "no user yet" check + INSERT in a transaction so two parallel
    // sign-ups can't both pass the guard. The transaction rolls back on the
    // throw, leaving the table untouched.
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM app_users'
      );
      if ((existing?.n ?? 0) > 0) {
        throw new Error('A user already exists.');
      }
      const id = newId();
      const createdAt = Date.now();
      await tx.execute(
        `INSERT INTO app_users (id, username, password_hash, created_at)
         VALUES ($1, $2, $3, $4)`,
        [id, input.username, input.passwordHash, createdAt]
      );
      return {
        id,
        username: input.username,
        passwordHash: input.passwordHash,
        createdAt,
      };
    });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const n = await this.db.execute(
      'UPDATE app_users SET password_hash = $1 WHERE id = $2',
      [passwordHash, id]
    );
    if (n === 0) {
      throw new Error('User not found.');
    }
  }
}
