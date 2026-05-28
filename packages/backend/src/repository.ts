import { DatabaseSync } from 'node:sqlite';
import {
  newId,
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
  /** G35 Part 2 (cycle-59) — SQLite bool-as-int. 0 = not critical (default),
   *  1 = critical. Mapped to JS bool by rowToComponent. */
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

export const openDatabase = (dbPath: string): DatabaseSync => {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(
    `CREATE TABLE IF NOT EXISTS panels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      floor_plan_filename TEXT,
      image_width INTEGER,
      image_height INTEGER
    );`
  );
  ensureColumn(db, 'panels', 'floor_plan_filename', 'TEXT');
  ensureColumn(db, 'panels', 'image_width', 'INTEGER');
  ensureColumn(db, 'panels', 'image_height', 'INTEGER');
  // G18 panel visualization: physical-layout metadata. Defaults cover all
  // pre-existing rows (vertical / 24 slots = typical residential).
  ensureColumn(
    db,
    'panels',
    'orientation',
    "TEXT NOT NULL DEFAULT 'vertical' CHECK(orientation IN ('vertical','horizontal'))"
  );
  ensureColumn(
    db,
    'panels',
    'slot_count',
    'INTEGER NOT NULL DEFAULT 24 CHECK(slot_count BETWEEN 1 AND 200)'
  );
  // G39 cycle-56 — subpanel hierarchy. Nullable FK to breakers(id) with
  // ON DELETE SET NULL — deleting the feeder breaker detaches the subpanel
  // rather than cascading. Belt-and-suspenders app-level UPDATE lives in
  // SqliteBreakerRepository.delete(). See CLAUDE.md "Subpanel hierarchy
  // (G39 — cycle-56)" for the contract.
  ensurePanelsParentBreakerIdColumn(db);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_panels_parent_breaker_id ON panels(parent_breaker_id);'
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS breakers (
      id TEXT PRIMARY KEY,
      panel_id TEXT NOT NULL REFERENCES panels(id),
      slot TEXT NOT NULL,
      slot_position INTEGER,
      amperage INTEGER NOT NULL,
      poles TEXT NOT NULL CHECK(poles IN ('single','double','tandem')),
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_breakers_panel_id ON breakers(panel_id);');
  db.exec(
    `CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN
        ('outlet','light','switch','appliance','junction_box','smoke_detector','other')),
      name TEXT NOT NULL,
      room TEXT,
      notes TEXT,
      breaker_id TEXT REFERENCES breakers(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );`
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_components_breaker_id ON components(breaker_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_components_room ON components(room);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);');
  ensureColumn(db, 'components', 'pos_x', 'INTEGER');
  ensureColumn(db, 'components', 'pos_y', 'INTEGER');
  // (Note: G19 gangs column added AFTER the rebuild migrations below —
  //  see ensureComponentsGangsColumn at the bottom of this fn so the
  //  ensureComponentsFloorIdColumn table-rebuild doesn't drop it.)

  ensureComponentsBreakerFkOnDeleteSetNull(db);

  // Floors table (G13 — multi-floor data model). Home-scoped (no parent FK
  // in single-house mode). See CLAUDE.md "Multi-floor model (G13)".
  db.exec(
    `CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INTEGER,
      floor_plan_filename TEXT,
      floor_plan_width INTEGER,
      floor_plan_height INTEGER,
      created_at INTEGER NOT NULL
    );`
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_floors_display_order ON floors(display_order);'
  );
  // Cycle-85 — floors.panel_id (nullable FK to panels, ON DELETE SET NULL).
  // Same shape as cycle-56 panels.parent_breaker_id. Components placed on a
  // floor with a linked panel default-wire to that panel in the form.
  // ALTER ADD first, then PRAGMA-check + rebuild for the FK action. See
  // CLAUDE.md "Floor → panel link (cycle-85)" for the contract.
  ensureFloorsPanelIdColumn(db);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_floors_panel_id ON floors(panel_id);'
  );

  // G13 — components.floor_id (nullable, ON DELETE SET NULL).
  ensureComponentsFloorIdColumn(db);

  // G19 — components.gangs MUST be added AFTER the floor_id rebuild above
  // (which uses a CREATE TABLE template that doesn't include gangs). Adding
  // gangs here via ALTER keeps it intact across all subsequent migrations.
  ensureColumn(
    db,
    'components',
    'gangs',
    'INTEGER NOT NULL DEFAULT 1 CHECK(gangs BETWEEN 1 AND 8)'
  );

  // G35 Part 2 cycle-59 — components.critical (SQLite bool-as-int). NOT NULL
  // DEFAULT 0 ensures pre-existing rows quietly become non-critical without
  // a backfill step. Same additive-migration pattern as gangs (G19). Future
  // rebuild templates MUST include this column.
  ensureColumn(
    db,
    'components',
    'critical',
    'INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0,1))'
  );

  // G34 cycle-42 — breakers.tandem_half. NULL for single + double pole; 'a'
  // or 'b' for tandem halves. A slot N may host EITHER one non-tandem
  // breaker OR up to two tandem-half breakers (one 'a' + one 'b').
  // Backfill: any existing tandem rows (poles='tandem') get 'a' as default
  // so they stay valid; the user can add the 'b' partner via the UI later.
  ensureColumn(
    db,
    'breakers',
    'tandem_half',
    `TEXT CHECK(tandem_half IN ('a','b') OR tandem_half IS NULL)`
  );
  // One-shot backfill for legacy tandem rows missing tandem_half (column was
  // just added — every existing tandem starts NULL, but we need it set to
  // 'a' so the slot-validation rule "tandem must have a half" stays sane).
  db.exec(
    `UPDATE breakers SET tandem_half = 'a' WHERE poles = 'tandem' AND tandem_half IS NULL`
  );

  // G37 cycle-68 — GFCI/AFCI/dual protection. Closed NEC nomenclature, so
  // a CHECK enum is defensible (same precedent as cycle-59 components.critical:
  // closed app-level state, NOT free user text like cycle-61 outcome).
  // Nullable: null = no protection. Same column shape on BOTH tables —
  // protection can live on the breaker (AFCI/GFCI breaker) OR on the
  // receptacle (GFCI outlet). Additive migration; pre-existing rows quietly
  // become protection=null. Future rebuild templates MUST include this column.
  // See CLAUDE.md "GFCI/AFCI protection (G37 Part 1 — cycle-68)".
  ensureColumn(
    db,
    'breakers',
    'protection',
    `TEXT CHECK(protection IN ('gfci','afci','dual') OR protection IS NULL)`
  );
  ensureColumn(
    db,
    'components',
    'protection',
    `TEXT CHECK(protection IN ('gfci','afci','dual') OR protection IS NULL)`
  );

  // G12 — walls table (vector floor-plan editor, walls subset).
  // floor_id NOT NULL + ON DELETE CASCADE: walls die with their floor
  // (differs from components.floor_id which is SET NULL). See
  // CLAUDE.md "Wall editor (G12 walls)".
  db.exec(
    `CREATE TABLE IF NOT EXISTS walls (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      x1 INTEGER NOT NULL CHECK (x1 BETWEEN 0 AND 10000),
      y1 INTEGER NOT NULL CHECK (y1 BETWEEN 0 AND 10000),
      x2 INTEGER NOT NULL CHECK (x2 BETWEEN 0 AND 10000),
      y2 INTEGER NOT NULL CHECK (y2 BETWEEN 0 AND 10000),
      created_at INTEGER NOT NULL
    );`
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_walls_floor_id ON walls(floor_id);');

  // G19 switch_controls: many-to-many from (switch, gang_index) to a
  // controlled component (light or outlet). Composite PK prevents duplicate
  // links. Cascade on both sides: deleting either component drops the row.
  db.exec(
    `CREATE TABLE IF NOT EXISTS switch_controls (
      switch_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      gang_index INTEGER NOT NULL CHECK(gang_index BETWEEN 0 AND 7),
      controlled_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      PRIMARY KEY (switch_id, gang_index, controlled_id)
    );`
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_switch_controls_switch ON switch_controls(switch_id);');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_switch_controls_controlled ON switch_controls(controlled_id);'
  );

  // G12 — rooms table (axis-aligned rectangles + center text label).
  // Same invariants as walls: floor_id NOT NULL + ON DELETE CASCADE.
  // w/h >= 1 (zero-area rectangles rejected). See CLAUDE.md.
  db.exec(
    `CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      x INTEGER NOT NULL CHECK (x BETWEEN 0 AND 10000),
      y INTEGER NOT NULL CHECK (y BETWEEN 0 AND 10000),
      w INTEGER NOT NULL CHECK (w BETWEEN 1 AND 10000),
      h INTEGER NOT NULL CHECK (h BETWEEN 1 AND 10000),
      created_at INTEGER NOT NULL
    );`
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_floor_id ON rooms(floor_id);');

  // G36 cycle-61 — breaker_tests (audit trail). Free-text outcome
  // (NOT a CHECK enum per the cycle-3 frozen-enum precedent). ON DELETE
  // CASCADE on breaker_id at the FK level + belt-and-suspenders DELETE
  // in SqliteBreakerRepository.delete()/deleteByPanel().
  // See CLAUDE.md "Breaker-test audit trail (G36 — cycle-61)".
  db.exec(
    `CREATE TABLE IF NOT EXISTS breaker_tests (
      id TEXT PRIMARY KEY,
      breaker_id TEXT NOT NULL REFERENCES breakers(id) ON DELETE CASCADE,
      tested_at INTEGER NOT NULL,
      outcome TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL
    );`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_breaker_tests_breaker_id_tested_at
     ON breaker_tests(breaker_id, tested_at DESC);`
  );
  // G36 Part 2 (cycle-63) — the /audit screen issues an unfiltered
  // (or weakly-filtered) ORDER BY tested_at DESC query. The existing
  // composite is leading-edge on breaker_id and not optimal for the
  // global ordering case. Additive index — safe to add idempotently.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_breaker_tests_tested_at
     ON breaker_tests(tested_at DESC);`
  );

  // G40 Part 1 cycle-66 — service_entries (dated service-log entries).
  // Polymorphic parent via (parent_type, parent_id). parent_type CHECK
  // is defensible: it's closed app-level state with exactly 2 values
  // ('breaker','component'). NOT free user text (different from cycle-61
  // outcome). Adding a 3rd parent_type later (floor, room) requires a
  // table rebuild — acceptable given the parent set is naturally
  // bounded by domain.
  //
  // SQLite can't enforce a polymorphic FK; cascade is APP-LEVEL in 3
  // sites (SqliteBreakerRepository.delete + .deleteByPanel +
  // SqliteComponentRepository.delete), each guarded by tableExists()
  // PRAGMA check (cycle-61 pattern). See CLAUDE.md "Service-log entries
  // (G40 Part 1 — cycle-66)".
  db.exec(
    `CREATE TABLE IF NOT EXISTS service_entries (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK(parent_type IN ('breaker','component')),
      parent_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_service_entries_parent
     ON service_entries(parent_type, parent_id, occurred_at DESC);`
  );

  // feat/auth-gate (sign-up flow) — app_users table.
  // Holds the single account row created via POST /auth/signup. There
  // is exactly 0 or 1 row at any moment; sign-up returns 409 when a
  // row already exists. UNIQUE(username) is belt-and-suspenders for
  // the "exactly one" invariant — without it, a future multi-user
  // migration only needs to drop the hasAnyUser() guard. password_hash
  // is the scrypt-encoded PHC-ish string from backend/src/password.ts.
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`
  );

  // G42(a) cycle-49 — UNIQUE name constraints on panels(name), floors(name),
  // and rooms(floor_id, name). Pre-migration dedup auto-suffixes existing
  // duplicates with " (2)", " (3)", ... before adding each UNIQUE index.
  // Idempotent: bails out early if all 3 indexes already exist.
  // See CLAUDE.md "UNIQUE name constraints (G42(a) — cycle-49)".
  ensureUniqueNames(db);

  // G13 — backfill existing per-panel floor plans into the new floors table.
  // Idempotent: gated on "no floor rows exist yet AND panels still have a
  // non-null floor_plan_filename". One-way migration — no down path.
  // See CLAUDE.md "Multi-floor model (G13)".
  backfillFloorsFromPanels(db);

  return db;
};

/**
 * G42(a) cycle-49: UNIQUE name constraints.
 *
 * Adds three UNIQUE indexes (panels.name, floors.name, rooms(floor_id, name))
 * after auto-suffixing any pre-existing duplicates with " (2)", " (3)", ...
 * The whole operation runs in one transaction; rollback on failure.
 *
 * Idempotent guard: all 3 indexes present → bail. On a fresh DB the panels/
 * floors/rooms tables are empty so the dedup step is a no-op and only the
 * CREATE INDEX statements run.
 *
 * Naming convention: the "first" duplicate (lowest created_at, then lowest
 * id) keeps its original name; the rest get " (2)", " (3)", ... starting at
 * 2. If "Foo (2)" already exists as a separate row, the candidate counter
 * increments until a free slot is found.
 */
const ensureUniqueNames = (db: DatabaseSync): void => {
  type IndexRow = { name: string };
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_unique_%'"
    )
    .all() as IndexRow[];
  const have = new Set(indexes.map((i) => i.name));
  if (
    have.has('idx_unique_panels_name') &&
    have.has('idx_unique_floors_name') &&
    have.has('idx_unique_rooms_floor_name')
  ) {
    return;
  }

  type NameRow = { id: string; name: string };

  /**
   * Dedup rows by `nameCol` within scope (global if scopeCol is null;
   * per-scopeCol-value if provided). Leaves the first row (created_at ASC,
   * id ASC) untouched; renames the rest with " (N)" suffixes.
   */
  const dedupGlobal = (table: string, nameCol: string): void => {
    type DupeGroup = { name: string };
    const dupes = db
      .prepare(
        `SELECT ${nameCol} AS name FROM ${table}
         GROUP BY ${nameCol} HAVING COUNT(*) > 1`
      )
      .all() as DupeGroup[];
    for (const group of dupes) {
      const rows = db
        .prepare(
          `SELECT id, ${nameCol} AS name FROM ${table}
           WHERE ${nameCol} = ?
           ORDER BY created_at ASC, id ASC`
        )
        .all(group.name) as NameRow[];
      // rows[0] keeps its name. Rename the rest.
      let counter = 2;
      for (let i = 1; i < rows.length; i++) {
        const baseName = rows[i]!.name;
        let candidate = `${baseName} (${counter})`;
        // If the candidate also collides with an existing row (in the same
        // global scope), bump the counter until we find a free slot.
        // Re-checking each iteration handles cases like ["Foo", "Foo",
        // "Foo (2)"] — the second "Foo" would normally become "Foo (2)"
        // which conflicts with the existing one, so we try "Foo (3)" next.
        while (true) {
          const conflict = db
            .prepare(`SELECT 1 AS hit FROM ${table} WHERE ${nameCol} = ? LIMIT 1`)
            .get(candidate) as { hit: number } | undefined;
          if (conflict === undefined) break;
          counter++;
          candidate = `${baseName} (${counter})`;
        }
        db.prepare(`UPDATE ${table} SET ${nameCol} = ? WHERE id = ?`).run(
          candidate,
          rows[i]!.id
        );
        counter++;
      }
    }
  };

  const dedupScoped = (
    table: string,
    scopeCol: string,
    nameCol: string
  ): void => {
    type DupeGroup = { scope: string; name: string };
    const dupes = db
      .prepare(
        `SELECT ${scopeCol} AS scope, ${nameCol} AS name FROM ${table}
         GROUP BY ${scopeCol}, ${nameCol} HAVING COUNT(*) > 1`
      )
      .all() as DupeGroup[];
    for (const group of dupes) {
      const rows = db
        .prepare(
          `SELECT id, ${nameCol} AS name FROM ${table}
           WHERE ${scopeCol} = ? AND ${nameCol} = ?
           ORDER BY created_at ASC, id ASC`
        )
        .all(group.scope, group.name) as NameRow[];
      let counter = 2;
      for (let i = 1; i < rows.length; i++) {
        const baseName = rows[i]!.name;
        let candidate = `${baseName} (${counter})`;
        while (true) {
          const conflict = db
            .prepare(
              `SELECT 1 AS hit FROM ${table}
               WHERE ${scopeCol} = ? AND ${nameCol} = ? LIMIT 1`
            )
            .get(group.scope, candidate) as { hit: number } | undefined;
          if (conflict === undefined) break;
          counter++;
          candidate = `${baseName} (${counter})`;
        }
        db.prepare(`UPDATE ${table} SET ${nameCol} = ? WHERE id = ?`).run(
          candidate,
          rows[i]!.id
        );
        counter++;
      }
    }
  };

  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    if (!have.has('idx_unique_panels_name')) {
      dedupGlobal('panels', 'name');
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_panels_name ON panels(name)'
      );
    }
    if (!have.has('idx_unique_floors_name')) {
      dedupGlobal('floors', 'name');
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_floors_name ON floors(name)'
      );
    }
    if (!have.has('idx_unique_rooms_floor_name')) {
      dedupScoped('rooms', 'floor_id', 'name');
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_rooms_floor_name ON rooms(floor_id, name)'
      );
    }
    commit.run();
  } catch (e) {
    rollback.run();
    throw e;
  }
};

/**
 * G13 backfill: for every panel where floor_plan_filename IS NOT NULL,
 * create a floor named after the panel (NOT "Main floor" — avoids
 * three-identical-names footgun) and inherit the filename + dimensions.
 * Then set floor_id on every component whose breaker's panel had a plan.
 *
 * Idempotent guard: runs only when (a) the floors table is empty AND
 * (b) at least one panel still has a non-null floor_plan_filename. Subsequent
 * starts of the server skip the backfill.
 *
 * Atomic: BEGIN/COMMIT/ROLLBACK wraps the whole thing.
 *
 * Note: we do NOT drop the legacy panels.floor_plan_filename / image_width /
 * image_height columns. They stay readable but ignored — keeps the migration
 * one-way without committing to a destructive table rebuild on the panels
 * table (which would also touch FK references from breakers and risk data
 * loss on partial failure). New code reads/writes floors. The dormant
 * columns get cleaned up in a future cycle after we're confident no rollback
 * is needed.
 */
const backfillFloorsFromPanels = (db: DatabaseSync): void => {
  type CountRow = { n: number };
  type Col = { name: string };

  // Safety gate: only run if floors table is empty (no migration has happened yet).
  const floorCount = (
    db.prepare('SELECT COUNT(*) AS n FROM floors').get() as CountRow
  ).n;
  if (floorCount > 0) return;

  // Inspect panels schema — if the legacy columns are gone, there's nothing
  // to migrate.
  const panelCols = db
    .prepare('PRAGMA table_info(panels);')
    .all() as Col[];
  const hasFilename = panelCols.some((c) => c.name === 'floor_plan_filename');
  const hasWidth = panelCols.some((c) => c.name === 'image_width');
  const hasHeight = panelCols.some((c) => c.name === 'image_height');
  if (!hasFilename || !hasWidth || !hasHeight) return;

  // Pull panels that have a floor plan worth migrating.
  type LegacyPanel = {
    id: string;
    name: string;
    floor_plan_filename: string;
    image_width: number;
    image_height: number;
  };
  const legacy = db
    .prepare(
      `SELECT id, name, floor_plan_filename, image_width, image_height
       FROM panels
       WHERE floor_plan_filename IS NOT NULL
         AND image_width IS NOT NULL
         AND image_height IS NOT NULL`
    )
    .all() as LegacyPanel[];
  if (legacy.length === 0) return;

  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    // Cycle-85: include panel_id in the INSERT so pre-G13 single-panel
    // homes get their backfilled floor linked to the originating panel.
    // The column may not exist yet (this backfill runs once on first
    // openDatabase post-migration); we check via PRAGMA and degrade
    // gracefully when missing.
    const floorCols = db.prepare('PRAGMA table_info(floors);').all() as Col[];
    const hasPanelId = floorCols.some((c) => c.name === 'panel_id');
    const insertFloor = db.prepare(
      hasPanelId
        ? `INSERT INTO floors
           (id, name, display_order, floor_plan_filename, floor_plan_width,
            floor_plan_height, created_at, panel_id)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
        : `INSERT INTO floors
           (id, name, display_order, floor_plan_filename, floor_plan_width,
            floor_plan_height, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?)`
    );
    const setComponentFloor = db.prepare(
      `UPDATE components
       SET floor_id = ?
       WHERE floor_id IS NULL
         AND breaker_id IN (SELECT id FROM breakers WHERE panel_id = ?)`
    );

    const now = Date.now();
    for (const p of legacy) {
      const floorId = newId();
      if (hasPanelId) {
        insertFloor.run(
          floorId,
          p.name, // name floor after panel — avoids "Main floor" x N footgun
          p.floor_plan_filename,
          p.image_width,
          p.image_height,
          now,
          p.id // cycle-85 — link backfilled floor to its originating panel
        );
      } else {
        insertFloor.run(
          floorId,
          p.name,
          p.floor_plan_filename,
          p.image_width,
          p.image_height,
          now
        );
      }
      setComponentFloor.run(floorId, p.id);
    }

    commit.run();
  } catch (e) {
    rollback.run();
    throw e;
  }
};

/**
 * G13: add `floor_id TEXT REFERENCES floors(id) ON DELETE SET NULL` to
 * components if absent. Uses ALTER TABLE first; FK is then applied by a
 * table rebuild if the column was created without one (PRAGMA reports it).
 *
 * Idempotent: if `floor_id` already has the SET NULL FK, returns early.
 */
const ensureComponentsFloorIdColumn = (db: DatabaseSync): void => {
  type Col = { name: string };
  type FkRow = { table: string; from: string; on_delete: string };

  const cols = db.prepare('PRAGMA table_info(components);').all() as Col[];
  const hasCol = cols.some((c) => c.name === 'floor_id');
  if (!hasCol) {
    // ALTER TABLE ADD COLUMN cannot embed a REFERENCES clause that SQLite
    // honors at FK enforcement time — so we add the bare column, then
    // rebuild the table to attach the FK action.
    db.exec('ALTER TABLE components ADD COLUMN floor_id TEXT;');
  }

  const fks = db.prepare('PRAGMA foreign_key_list(components);').all() as FkRow[];
  const floorFk = fks.find((fk) => fk.from === 'floor_id');
  if (floorFk && floorFk.on_delete === 'SET NULL') return;

  // Rebuild to attach the FK with ON DELETE SET NULL (matches breaker_id).
  //
  // G19 + G35 Part 2 (cycle-59) + G37 (cycle-68): the rebuild template MUST
  // include `gangs`, `critical`, AND `protection` columns conditionally so
  // that a re-run of this rebuild on a DB that already has them does not
  // drop them. Each is added only if PRAGMA table_info reports its presence
  // in the source table; on a brand-new DB that path doesn't apply (the
  // columns are added by ensureColumn AFTER this rebuild runs).
  db.exec('PRAGMA foreign_keys=OFF;');
  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    const hasGangs = cols.some((c) => c.name === 'gangs');
    const hasCritical = cols.some((c) => c.name === 'critical');
    const hasProtection = cols.some((c) => c.name === 'protection');
    const extraDecls =
      (hasGangs
        ? ', gangs INTEGER NOT NULL DEFAULT 1 CHECK(gangs BETWEEN 1 AND 8)'
        : '') +
      (hasCritical
        ? ', critical INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0,1))'
        : '') +
      (hasProtection
        ? `, protection TEXT CHECK(protection IN ('gfci','afci','dual') OR protection IS NULL)`
        : '');
    const extraCols =
      (hasGangs ? ', gangs' : '') +
      (hasCritical ? ', critical' : '') +
      (hasProtection ? ', protection' : '');

    db.exec(
      `CREATE TABLE components_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN
          ('outlet','light','switch','appliance','junction_box','smoke_detector','other')),
        name TEXT NOT NULL,
        room TEXT,
        notes TEXT,
        breaker_id TEXT REFERENCES breakers(id) ON DELETE SET NULL,
        floor_id TEXT REFERENCES floors(id) ON DELETE SET NULL,
        pos_x INTEGER,
        pos_y INTEGER,
        created_at INTEGER NOT NULL${extraDecls}
      );`
    );
    db.exec(
      `INSERT INTO components_new
       (id, type, name, room, notes, breaker_id, floor_id, pos_x, pos_y, created_at${extraCols})
       SELECT id, type, name, room, notes, breaker_id, floor_id, pos_x, pos_y, created_at${extraCols}
       FROM components;`
    );
    db.exec('DROP TABLE components;');
    db.exec('ALTER TABLE components_new RENAME TO components;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_breaker_id ON components(breaker_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_floor_id ON components(floor_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_room ON components(room);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);');
    commit.run();
  } catch (e) {
    rollback.run();
    db.exec('PRAGMA foreign_keys=ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys=ON;');
};

/**
 * G39 cycle-56: add `parent_breaker_id TEXT REFERENCES breakers(id) ON DELETE
 * SET NULL` to panels if absent. ALTER TABLE ADD COLUMN cannot embed a
 * REFERENCES clause SQLite honors at FK-enforcement time, so we add the
 * bare column first, then rebuild the table to attach the FK action.
 *
 * Idempotent: bails out early if the column already has the SET NULL FK.
 */
const ensurePanelsParentBreakerIdColumn = (db: DatabaseSync): void => {
  type Col = { name: string };
  type FkRow = { table: string; from: string; on_delete: string };

  const cols = db.prepare('PRAGMA table_info(panels);').all() as Col[];
  const hasCol = cols.some((c) => c.name === 'parent_breaker_id');
  if (!hasCol) {
    db.exec('ALTER TABLE panels ADD COLUMN parent_breaker_id TEXT;');
  }

  const fks = db.prepare('PRAGMA foreign_key_list(panels);').all() as FkRow[];
  const fk = fks.find((f) => f.from === 'parent_breaker_id');
  if (fk && fk.on_delete === 'SET NULL') return;

  // Rebuild to attach the FK with ON DELETE SET NULL.
  db.exec('PRAGMA foreign_keys=OFF;');
  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    db.exec(
      `CREATE TABLE panels_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        floor_plan_filename TEXT,
        image_width INTEGER,
        image_height INTEGER,
        orientation TEXT NOT NULL DEFAULT 'vertical'
          CHECK(orientation IN ('vertical','horizontal')),
        slot_count INTEGER NOT NULL DEFAULT 24
          CHECK(slot_count BETWEEN 1 AND 200),
        parent_breaker_id TEXT REFERENCES breakers(id) ON DELETE SET NULL
      );`
    );
    db.exec(
      `INSERT INTO panels_new
       (id, name, created_at, floor_plan_filename, image_width, image_height,
        orientation, slot_count, parent_breaker_id)
       SELECT id, name, created_at, floor_plan_filename, image_width, image_height,
              orientation, slot_count, parent_breaker_id
       FROM panels;`
    );
    db.exec('DROP TABLE panels;');
    db.exec('ALTER TABLE panels_new RENAME TO panels;');
    commit.run();
  } catch (e) {
    rollback.run();
    db.exec('PRAGMA foreign_keys=ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys=ON;');
};

/**
 * Cycle-85: add `floors.panel_id TEXT NULL REFERENCES panels(id) ON DELETE
 * SET NULL` if it doesn't already exist with the correct FK action.
 *
 * Mirrors cycle-56 G39 `ensurePanelsParentBreakerIdColumn` pattern: ALTER
 * ADD COLUMN first (so the column is queryable immediately), then PRAGMA-
 * check the FK action. If the FK is missing or has the wrong action, rebuild
 * the floors table inside a transaction with foreign_keys=OFF.
 *
 * Idempotent: bails out early if the column already has the SET NULL FK.
 */
const ensureFloorsPanelIdColumn = (db: DatabaseSync): void => {
  type Col = { name: string };
  type FkRow = { table: string; from: string; on_delete: string };

  const cols = db.prepare('PRAGMA table_info(floors);').all() as Col[];
  const hasCol = cols.some((c) => c.name === 'panel_id');
  if (!hasCol) {
    db.exec('ALTER TABLE floors ADD COLUMN panel_id TEXT;');
  }

  const fks = db.prepare('PRAGMA foreign_key_list(floors);').all() as FkRow[];
  const fk = fks.find((f) => f.from === 'panel_id');
  if (fk && fk.on_delete === 'SET NULL') return;

  // Rebuild to attach the FK with ON DELETE SET NULL.
  db.exec('PRAGMA foreign_keys=OFF;');
  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    db.exec(
      `CREATE TABLE floors_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_order INTEGER,
        floor_plan_filename TEXT,
        floor_plan_width INTEGER,
        floor_plan_height INTEGER,
        created_at INTEGER NOT NULL,
        panel_id TEXT REFERENCES panels(id) ON DELETE SET NULL
      );`
    );
    db.exec(
      `INSERT INTO floors_new
       (id, name, display_order, floor_plan_filename, floor_plan_width,
        floor_plan_height, created_at, panel_id)
       SELECT id, name, display_order, floor_plan_filename, floor_plan_width,
              floor_plan_height, created_at, panel_id
       FROM floors;`
    );
    db.exec('DROP TABLE floors;');
    db.exec('ALTER TABLE floors_new RENAME TO floors;');
    // Re-create the display_order index dropped with the table.
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_floors_display_order ON floors(display_order);'
    );
    commit.run();
  } catch (e) {
    rollback.run();
    db.exec('PRAGMA foreign_keys=ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys=ON;');
};

const ensureColumn = (
  db: DatabaseSync,
  table: string,
  column: string,
  type: string
): void => {
  type Info = { name: string };
  const cols = db.prepare(`PRAGMA table_info(${table});`).all() as Info[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
};

const ensureComponentsBreakerFkOnDeleteSetNull = (db: DatabaseSync): void => {
  type Col = { name: string };
  type FkRow = { table: string; from: string; on_delete: string };
  const fks = db.prepare('PRAGMA foreign_key_list(components);').all() as FkRow[];
  const breakerFk = fks.find((fk) => fk.from === 'breaker_id');
  if (!breakerFk || breakerFk.on_delete === 'SET NULL') return;

  // Pre-existing components table has a different FK action. Rebuild via the
  // SQLite-documented "create new, copy, drop, rename" pattern.
  //
  // G19 + G35 Part 2 (cycle-59) + G37 (cycle-68): include `gangs`, `critical`,
  // AND `protection` conditionally so a re-run of this rebuild on a DB that
  // already has them does not drop them. Same pattern as
  // ensureComponentsFloorIdColumn below.
  const cols = db.prepare('PRAGMA table_info(components);').all() as Col[];
  const hasFloorId = cols.some((c) => c.name === 'floor_id');
  const hasPosX = cols.some((c) => c.name === 'pos_x');
  const hasPosY = cols.some((c) => c.name === 'pos_y');
  const hasGangs = cols.some((c) => c.name === 'gangs');
  const hasCritical = cols.some((c) => c.name === 'critical');
  const hasProtection = cols.some((c) => c.name === 'protection');

  db.exec('PRAGMA foreign_keys=OFF;');
  const begin = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    const extraDecls =
      (hasFloorId
        ? ', floor_id TEXT REFERENCES floors(id) ON DELETE SET NULL'
        : '') +
      (hasPosX ? ', pos_x INTEGER' : '') +
      (hasPosY ? ', pos_y INTEGER' : '') +
      (hasGangs
        ? ', gangs INTEGER NOT NULL DEFAULT 1 CHECK(gangs BETWEEN 1 AND 8)'
        : '') +
      (hasCritical
        ? ', critical INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0,1))'
        : '') +
      (hasProtection
        ? `, protection TEXT CHECK(protection IN ('gfci','afci','dual') OR protection IS NULL)`
        : '');
    const extraCols =
      (hasFloorId ? ', floor_id' : '') +
      (hasPosX ? ', pos_x' : '') +
      (hasPosY ? ', pos_y' : '') +
      (hasGangs ? ', gangs' : '') +
      (hasCritical ? ', critical' : '') +
      (hasProtection ? ', protection' : '');

    db.exec(
      `CREATE TABLE components_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN
          ('outlet','light','switch','appliance','junction_box','smoke_detector','other')),
        name TEXT NOT NULL,
        room TEXT,
        notes TEXT,
        breaker_id TEXT REFERENCES breakers(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL${extraDecls}
      );`
    );
    db.exec(
      `INSERT INTO components_new (id, type, name, room, notes, breaker_id, created_at${extraCols})
       SELECT id, type, name, room, notes, breaker_id, created_at${extraCols} FROM components;`
    );
    db.exec('DROP TABLE components;');
    db.exec('ALTER TABLE components_new RENAME TO components;');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_components_breaker_id ON components(breaker_id);'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_room ON components(room);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);');
    commit.run();
  } catch (e) {
    rollback.run();
    db.exec('PRAGMA foreign_keys=ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys=ON;');
};

export class SqlitePanelRepository implements PanelRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<Panel[]> {
    const rows = this.db
      .prepare(
        'SELECT id, name, created_at, floor_plan_filename, image_width, image_height, orientation, slot_count, parent_breaker_id FROM panels ORDER BY created_at ASC, id ASC'
      )
      .all() as PanelRow[];
    return rows.map(rowToPanel);
  }

  async create(input: {
    name: string;
    orientation?: PanelOrientation;
    slotCount?: number;
    parentBreakerId?: string | null;
  }): Promise<Panel> {
    const panel: Panel = {
      id: newId(),
      name: input.name,
      createdAt: Date.now(),
      floorPlan: null,
      orientation: input.orientation ?? 'vertical',
      slotCount: input.slotCount ?? 24,
      parentBreakerId: input.parentBreakerId ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO panels (id, name, created_at, orientation, slot_count, parent_breaker_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        panel.id,
        panel.name,
        panel.createdAt,
        panel.orientation,
        panel.slotCount,
        panel.parentBreakerId
      );
    return panel;
  }

  async get(id: string): Promise<Panel | null> {
    const row = this.db
      .prepare(
        'SELECT id, name, created_at, floor_plan_filename, image_width, image_height, orientation, slot_count, parent_breaker_id FROM panels WHERE id = ?'
      )
      .get(id) as PanelRow | undefined;
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
    this.db
      .prepare(
        'UPDATE panels SET name = ?, orientation = ?, slot_count = ?, parent_breaker_id = ? WHERE id = ?'
      )
      .run(
        merged.name,
        merged.orientation,
        merged.slotCount,
        merged.parentBreakerId,
        id
      );
    return merged;
  }

  async setFloorPlan(panelId: string, plan: FloorPlan): Promise<Panel | null> {
    const result = this.db
      .prepare(
        'UPDATE panels SET floor_plan_filename = ?, image_width = ?, image_height = ? WHERE id = ?'
      )
      .run(plan.filename, plan.width, plan.height, panelId);
    if (result.changes === 0) return null;
    return this.get(panelId);
  }

  async clearFloorPlan(panelId: string): Promise<Panel | null> {
    const result = this.db
      .prepare(
        'UPDATE panels SET floor_plan_filename = NULL, image_width = NULL, image_height = NULL WHERE id = ?'
      )
      .run(panelId);
    if (result.changes === 0) return null;
    return this.get(panelId);
  }

  async delete(id: string): Promise<boolean> {
    // Iterate this panel's breakers so the component-null cascade in
    // SqliteBreakerRepository.delete composes inside a single outer transaction.
    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');
    tx.run();
    try {
      const breakerIds = (
        this.db
          .prepare('SELECT id FROM breakers WHERE panel_id = ?')
          .all(id) as { id: string }[]
      ).map((r) => r.id);
      // G39 cycle-56 — check parent_breaker_id column once outside the loop.
      const panelCols = this.db
        .prepare('PRAGMA table_info(panels);')
        .all() as { name: string }[];
      const hasParentCol = panelCols.some((c) => c.name === 'parent_breaker_id');
      // G40 cycle-66 — check service_entries table once outside the loop.
      const hasServiceEntries = tableExists(this.db, 'service_entries');
      // Cycle-85 — belt-and-suspenders: floors.panel_id ON DELETE SET NULL
      // is the DB-level invariant; this UPDATE is greppable and survives a
      // future migration that forgets the FK clause. Guarded by a column-
      // existence check so the repo stays usable before the migration runs.
      const floorCols = this.db
        .prepare('PRAGMA table_info(floors);')
        .all() as { name: string }[];
      if (floorCols.some((c) => c.name === 'panel_id')) {
        this.db
          .prepare('UPDATE floors SET panel_id = NULL WHERE panel_id = ?')
          .run(id);
      }
      for (const breakerId of breakerIds) {
        this.db
          .prepare('UPDATE components SET breaker_id = NULL WHERE breaker_id = ?')
          .run(breakerId);
        if (hasParentCol) {
          // Detach any subpanel fed by this breaker (belt-and-suspenders).
          this.db
            .prepare(
              'UPDATE panels SET parent_breaker_id = NULL WHERE parent_breaker_id = ?'
            )
            .run(breakerId);
        }
        // G40 cycle-66 — service_entries (breaker-parent) cascade. No FK
        // (polymorphic), so this APP-LEVEL DELETE is THE invariant.
        if (hasServiceEntries) {
          this.db
            .prepare(
              `DELETE FROM service_entries
               WHERE parent_type = 'breaker' AND parent_id = ?`
            )
            .run(breakerId);
        }
        this.db.prepare('DELETE FROM breakers WHERE id = ?').run(breakerId);
      }
      const result = this.db.prepare('DELETE FROM panels WHERE id = ?').run(id);
      commit.run();
      return result.changes > 0;
    } catch (e) {
      rollback.run();
      throw e;
    }
  }
}

export class SqliteBreakerRepository implements BreakerRepository {
  constructor(private readonly db: DatabaseSync) {}

  async listByPanel(panelId: string): Promise<Breaker[]> {
    const rows = this.db
      .prepare(
        `SELECT id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at
         FROM breakers
         WHERE panel_id = ?
         ORDER BY slot_position IS NULL, slot_position ASC, tandem_half ASC, slot ASC`
      )
      .all(panelId) as BreakerRow[];
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
      // G37 cycle-68 — default null when absent. CHECK enum at the DB
      // layer rejects any value not in the closed set.
      protection: input.protection ?? null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO breakers (id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        breaker.id,
        breaker.panelId,
        breaker.slot,
        breaker.slotPosition,
        breaker.amperage,
        breaker.poles,
        breaker.label,
        breaker.tandemHalf,
        breaker.protection,
        breaker.createdAt
      );
    return breaker;
  }

  async get(id: string): Promise<Breaker | null> {
    const row = this.db
      .prepare(
        `SELECT id, panel_id, slot, slot_position, amperage, poles, label, tandem_half, protection, created_at
         FROM breakers WHERE id = ?`
      )
      .get(id) as BreakerRow | undefined;
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
      // G37 cycle-68 — preserve existing when not in patch; otherwise apply
      // (and coerce undefined-inside-defined to null).
      protection:
        patch.protection === undefined ? existing.protection : patch.protection ?? null,
    };

    this.db
      .prepare(
        `UPDATE breakers
         SET slot = ?, slot_position = ?, amperage = ?, poles = ?, label = ?, tandem_half = ?, protection = ?
         WHERE id = ?`
      )
      .run(
        merged.slot,
        merged.slotPosition,
        merged.amperage,
        merged.poles,
        merged.label,
        merged.tandemHalf,
        merged.protection,
        id
      );

    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');
    tx.run();
    try {
      this.db
        .prepare('UPDATE components SET breaker_id = NULL WHERE breaker_id = ?')
        .run(id);
      // G39 cycle-56 — belt-and-suspenders detach of any subpanel fed by
      // this breaker. The FK ON DELETE SET NULL is the DB-level invariant;
      // this UPDATE is greppable and survives a future migration that
      // forgets the FK clause. Guarded by a column-existence check so the
      // repo stays usable before the migration runs.
      const panelCols = this.db
        .prepare('PRAGMA table_info(panels);')
        .all() as { name: string }[];
      if (panelCols.some((c) => c.name === 'parent_breaker_id')) {
        this.db
          .prepare(
            'UPDATE panels SET parent_breaker_id = NULL WHERE parent_breaker_id = ?'
          )
          .run(id);
      }
      // G36 cycle-61 — belt-and-suspenders audit-trail cascade. The FK
      // ON DELETE CASCADE is the DB-level invariant; this DELETE is
      // greppable and survives a future migration that forgets the FK
      // clause. Guarded by a table-existence check so the repo stays
      // usable on DBs predating the table.
      if (tableExists(this.db, 'breaker_tests')) {
        this.db
          .prepare('DELETE FROM breaker_tests WHERE breaker_id = ?')
          .run(id);
      }
      // G40 cycle-66 — service_entries has no FK (polymorphic). Cascade
      // is APP-LEVEL only; this is THE invariant. Same tableExists()
      // guard as the breaker_tests cascade above.
      if (tableExists(this.db, 'service_entries')) {
        this.db
          .prepare(
            `DELETE FROM service_entries
             WHERE parent_type = 'breaker' AND parent_id = ?`
          )
          .run(id);
      }
      const result = this.db.prepare('DELETE FROM breakers WHERE id = ?').run(id);
      commit.run();
      return result.changes > 0;
    } catch (e) {
      rollback.run();
      throw e;
    }
  }

  async deleteByPanel(panelId: string): Promise<void> {
    // G39 cycle-56 — same belt-and-suspenders detach for every breaker on
    // this panel before bulk-deleting them, so child subpanels survive.
    const panelCols = this.db
      .prepare('PRAGMA table_info(panels);')
      .all() as { name: string }[];
    if (panelCols.some((c) => c.name === 'parent_breaker_id')) {
      this.db
        .prepare(
          `UPDATE panels SET parent_breaker_id = NULL
           WHERE parent_breaker_id IN (SELECT id FROM breakers WHERE panel_id = ?)`
        )
        .run(panelId);
    }
    // G36 cycle-61 — belt-and-suspenders audit-trail cascade for bulk delete.
    if (tableExists(this.db, 'breaker_tests')) {
      this.db
        .prepare(
          `DELETE FROM breaker_tests
           WHERE breaker_id IN (SELECT id FROM breakers WHERE panel_id = ?)`
        )
        .run(panelId);
    }
    // G40 cycle-66 — service_entries (breaker-parent) cascade for bulk delete.
    // Same tableExists guard pattern; APP-LEVEL invariant (no FK).
    if (tableExists(this.db, 'service_entries')) {
      this.db
        .prepare(
          `DELETE FROM service_entries
           WHERE parent_type = 'breaker'
             AND parent_id IN (SELECT id FROM breakers WHERE panel_id = ?)`
        )
        .run(panelId);
    }
    this.db.prepare('DELETE FROM breakers WHERE panel_id = ?').run(panelId);
  }
}

const tableExists = (db: DatabaseSync, name: string): boolean => {
  const row = db
    .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(name) as { hit: number } | undefined;
  return row !== undefined;
};

export class SqliteComponentRepository implements ComponentRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(filter?: ComponentListFilter): Promise<ResolvedComponent[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.room !== undefined) {
      where.push('c.room = ?');
      params.push(filter.room);
    }
    if (filter?.type !== undefined) {
      where.push('c.type = ?');
      params.push(filter.type);
    }
    if (filter?.breakerId !== undefined) {
      where.push('c.breaker_id = ?');
      params.push(filter.breakerId);
    }
    if (filter?.floorId !== undefined) {
      where.push('c.floor_id = ?');
      params.push(filter.floorId);
    }
    if (filter?.search !== undefined) {
      // G40 Part 2 (cycle-67): search ALSO matches service_entries.note
      // content. The EXISTS subquery avoids row duplication (vs a LEFT JOIN
      // which would multiply rows by matching log entries) — a single
      // component matches ONCE even if it has multiple matching log entries
      // (EXISTS short-circuits on first hit).
      //
      // Performance: the EXISTS uses the cycle-66 composite index
      // idx_service_entries_parent(parent_type, parent_id, occurred_at DESC)
      // for the parent_id lookup; the note LIKE is a table-scan within the
      // matching entries — acceptable given the small per-component entry
      // count in practice.
      //
      // Sort order unchanged ("search filters, never reorders" — see CLAUDE.md).
      where.push(
        `(LOWER(c.name) LIKE LOWER(?)
          OR (c.room IS NOT NULL AND LOWER(c.room) LIKE LOWER(?))
          OR EXISTS (
            SELECT 1 FROM service_entries
            WHERE service_entries.parent_type = 'component'
              AND service_entries.parent_id = c.id
              AND LOWER(service_entries.note) LIKE LOWER(?)
          ))`
      );
      const like = `%${filter.search}%`;
      params.push(like, like, like);
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
    const rows = this.db.prepare(sql).all(...params) as ResolvedComponentRow[];
    return rows.map(rowToResolvedComponent);
  }

  async create(input: ComponentInput): Promise<Component> {
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
      // G37 cycle-68 — default null when absent. CHECK enum rejects
      // any value not in the closed set at the DB layer.
      protection: input.protection ?? null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO components (id, type, name, room, notes, breaker_id, floor_id, pos_x, pos_y, gangs, critical, protection, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
        component.createdAt
      );
    return component;
  }

  async get(id: string): Promise<ResolvedComponent | null> {
    const row = this.db
      .prepare(
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
         WHERE c.id = ?`
      )
      .get(id) as ResolvedComponentRow | undefined;
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
      // G37 cycle-68 — preserve existing when not in patch; otherwise apply
      // (and coerce undefined-inside-defined to null).
      protection:
        patch.protection === undefined ? existing.protection : patch.protection ?? null,
    };

    // Refactor 2026-05 follow-up — switch+controlled share one circuit.
    // When a switch's breakerId is being patched, propagate the new
    // breakerId to every component the switch controls. Electrical reality:
    // the switch is on the same circuit as the load it controls; recording
    // them on different breakers would mislead the test/audit views.
    // ALWAYS propagates — including null → null — so the invariant
    // "switch.breakerId === every controlled.breakerId" holds. Wrap in a
    // transaction so a propagation failure leaves the switch unchanged.
    const propagateBreaker =
      merged.type === 'switch' &&
      patch.breakerId !== undefined &&
      merged.breakerId !== existing.breakerId &&
      tableExists(this.db, 'switch_controls');

    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');
    tx.run();
    try {
      this.db
        .prepare(
          `UPDATE components
           SET type = ?, name = ?, room = ?, notes = ?, breaker_id = ?, floor_id = ?, pos_x = ?, pos_y = ?, gangs = ?, critical = ?, protection = ?
           WHERE id = ?`
        )
        .run(
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
          id
        );

      if (propagateBreaker) {
        type Row = { controlled_id: string };
        const rows = this.db
          .prepare(
            'SELECT controlled_id FROM switch_controls WHERE switch_id = ?'
          )
          .all(id) as Row[];
        const updateControlled = this.db.prepare(
          'UPDATE components SET breaker_id = ? WHERE id = ?'
        );
        for (const r of rows) {
          updateControlled.run(merged.breakerId, r.controlled_id);
        }
      }

      commit.run();
    } catch (e) {
      rollback.run();
      throw e;
    }

    return merged;
  }

  async delete(id: string): Promise<boolean> {
    // G40 cycle-66 — belt-and-suspenders cascade of service_entries with
    // parent_type='component'. No FK (polymorphic), so this APP-LEVEL
    // DELETE is THE invariant. Wrap in a transaction so a failure leaves
    // the component intact. tableExists() guard mirrors the breaker
    // cascade pattern (cycle-61).
    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');
    tx.run();
    try {
      if (tableExists(this.db, 'service_entries')) {
        this.db
          .prepare(
            `DELETE FROM service_entries
             WHERE parent_type = 'component' AND parent_id = ?`
          )
          .run(id);
      }
      const result = this.db.prepare('DELETE FROM components WHERE id = ?').run(id);
      commit.run();
      return result.changes > 0;
    } catch (e) {
      rollback.run();
      throw e;
    }
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
  'display_order IS NULL, display_order ASC, created_at ASC, id ASC';

export class SqliteFloorRepository implements FloorRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<Floor[]> {
    const rows = this.db
      .prepare(`SELECT ${FLOOR_COLS} FROM floors ORDER BY ${FLOOR_SORT}`)
      .all() as FloorRow[];
    return rows.map(rowToFloor);
  }

  async create(input: FloorInput): Promise<Floor> {
    const floor: Floor = {
      id: newId(),
      name: input.name,
      displayOrder: input.displayOrder ?? null,
      createdAt: Date.now(),
      floorPlan: null,
      // Cycle-85 — linked panel for default-wiring.
      panelId: input.panelId ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO floors (id, name, display_order, created_at, panel_id) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        floor.id,
        floor.name,
        floor.displayOrder,
        floor.createdAt,
        floor.panelId
      );
    return floor;
  }

  async get(id: string): Promise<Floor | null> {
    const row = this.db
      .prepare(`SELECT ${FLOOR_COLS} FROM floors WHERE id = ?`)
      .get(id) as FloorRow | undefined;
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
      // Cycle-85 — panelId. undefined = leave alone (omit from PATCH);
      // null = explicit clear. Same convention as displayOrder above.
      panelId:
        patch.panelId === undefined
          ? existing.panelId
          : patch.panelId ?? null,
    };
    this.db
      .prepare(
        'UPDATE floors SET name = ?, display_order = ?, panel_id = ? WHERE id = ?'
      )
      .run(merged.name, merged.displayOrder, merged.panelId, id);
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    // Cascade: NULL out any components pointing at this floor BEFORE deleting
    // it. Mirrors the breaker-delete pattern (CLAUDE.md cascade section).
    // Wrapped in one transaction; node:sqlite has no nested transactions, so
    // the UPDATE + DELETE run as a flat pair.
    //
    // Guarded by a column-existence check on components.floor_id: in the
    // current repo state US-002 hasn't added the column yet, so we skip the
    // UPDATE if it's absent. Once US-002 ships, the UPDATE always runs.
    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');
    tx.run();
    try {
      const cols = this.db
        .prepare('PRAGMA table_info(components);')
        .all() as { name: string }[];
      if (cols.some((c) => c.name === 'floor_id')) {
        this.db
          .prepare('UPDATE components SET floor_id = NULL WHERE floor_id = ?')
          .run(id);
      }
      const result = this.db.prepare('DELETE FROM floors WHERE id = ?').run(id);
      commit.run();
      return result.changes > 0;
    } catch (e) {
      rollback.run();
      throw e;
    }
  }

  async setFloorPlan(floorId: string, plan: FloorPlan): Promise<Floor | null> {
    const result = this.db
      .prepare(
        'UPDATE floors SET floor_plan_filename = ?, floor_plan_width = ?, floor_plan_height = ? WHERE id = ?'
      )
      .run(plan.filename, plan.width, plan.height, floorId);
    if (result.changes === 0) return null;
    return this.get(floorId);
  }

  async clearFloorPlan(floorId: string): Promise<Floor | null> {
    const result = this.db
      .prepare(
        'UPDATE floors SET floor_plan_filename = NULL, floor_plan_width = NULL, floor_plan_height = NULL WHERE id = ?'
      )
      .run(floorId);
    if (result.changes === 0) return null;
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

export class SqliteWallRepository implements WallRepository {
  constructor(private readonly db: DatabaseSync) {}

  async listByFloor(floorId: string): Promise<Wall[]> {
    const rows = this.db
      .prepare(
        `SELECT ${WALL_COLS} FROM walls WHERE floor_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(floorId) as WallRow[];
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
    this.db
      .prepare(
        `INSERT INTO walls (id, floor_id, x1, y1, x2, y2, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(wall.id, wall.floorId, wall.x1, wall.y1, wall.x2, wall.y2, wall.createdAt);
    return wall;
  }

  async get(id: string): Promise<Wall | null> {
    const row = this.db
      .prepare(`SELECT ${WALL_COLS} FROM walls WHERE id = ?`)
      .get(id) as WallRow | undefined;
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
    this.db
      .prepare('UPDATE walls SET x1 = ?, y1 = ?, x2 = ?, y2 = ? WHERE id = ?')
      .run(merged.x1, merged.y1, merged.x2, merged.y2, id);
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM walls WHERE id = ?').run(id);
    return result.changes > 0;
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
  createdAt: row.created_at,
});

const ROOM_COLS = 'id, floor_id, name, x, y, w, h, created_at';

export class SqliteRoomRepository implements RoomRepository {
  constructor(private readonly db: DatabaseSync) {}

  async listByFloor(floorId: string): Promise<Room[]> {
    const rows = this.db
      .prepare(
        `SELECT ${ROOM_COLS} FROM rooms WHERE floor_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(floorId) as RoomRow[];
    return rows.map(rowToRoom);
  }

  async listAll(): Promise<Room[]> {
    // Cycle-85 — flat house-level read for ComponentForm Room datalist.
    // Same sort as listByFloor for consistency. Used only by GET /rooms.
    const rows = this.db
      .prepare(
        `SELECT ${ROOM_COLS} FROM rooms
         ORDER BY created_at ASC, id ASC`
      )
      .all() as RoomRow[];
    return rows.map(rowToRoom);
  }

  async create(floorId: string, input: RoomInput): Promise<Room> {
    const room: Room = {
      id: newId(),
      floorId,
      name: input.name,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO rooms (id, floor_id, name, x, y, w, h, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        room.id,
        room.floorId,
        room.name,
        room.x,
        room.y,
        room.w,
        room.h,
        room.createdAt
      );
    return room;
  }

  async get(id: string): Promise<Room | null> {
    const row = this.db
      .prepare(`SELECT ${ROOM_COLS} FROM rooms WHERE id = ?`)
      .get(id) as RoomRow | undefined;
    return row ? rowToRoom(row) : null;
  }

  async update(id: string, patch: Partial<RoomInput>): Promise<Room | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    // SQL never touches floor_id — rooms don't migrate between floors.
    const merged: Room = {
      ...existing,
      name: patch.name ?? existing.name,
      x: patch.x ?? existing.x,
      y: patch.y ?? existing.y,
      w: patch.w ?? existing.w,
      h: patch.h ?? existing.h,
    };
    this.db
      .prepare(
        'UPDATE rooms SET name = ?, x = ?, y = ?, w = ?, h = ? WHERE id = ?'
      )
      .run(merged.name, merged.x, merged.y, merged.w, merged.h, id);
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    return result.changes > 0;
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

export class SqliteBreakerTestRepository implements BreakerTestRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(filter?: BreakerTestListFilter): Promise<BreakerTestListResult> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.breakerId !== undefined) {
      where.push('breaker_id = ?');
      params.push(filter.breakerId);
    }
    if (filter?.since !== undefined) {
      where.push('tested_at >= ?');
      params.push(filter.since);
    }
    if (filter?.until !== undefined) {
      where.push('tested_at <= ?');
      params.push(filter.until);
    }
    if (filter?.outcome !== undefined) {
      where.push('outcome = ?');
      params.push(filter.outcome);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // G36 Part 2 (cycle-63) — totalCount is the WHERE-filtered count
    // BEFORE the LIMIT is applied, so the UI can render "Showing N of M".
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM breaker_tests ${whereClause}`)
      .get(...params) as { count: number } | undefined;
    const totalCount = totalRow?.count ?? 0;

    let sql = `SELECT ${BREAKER_TEST_COLS} FROM breaker_tests
      ${whereClause}
      ORDER BY tested_at DESC, id DESC`;
    const queryParams = [...params];
    if (filter?.limit !== undefined) {
      sql += ' LIMIT ?';
      queryParams.push(filter.limit);
    }
    const rows = this.db.prepare(sql).all(...queryParams) as BreakerTestRow[];
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
    this.db
      .prepare(
        `INSERT INTO breaker_tests (${BREAKER_TEST_COLS})
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        test.id,
        test.breakerId,
        test.testedAt,
        test.outcome,
        test.notes,
        test.createdAt
      );
    return test;
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM breaker_tests WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  async latestByBreaker(
    breakerIds: readonly string[]
  ): Promise<Map<string, BreakerTest | null>> {
    const out = new Map<string, BreakerTest | null>();
    for (const id of breakerIds) out.set(id, null);
    if (breakerIds.length === 0) return out;
    // For each breakerId, fetch the single most-recent row. The composite
    // index (breaker_id, tested_at DESC) makes this O(log n) per breaker.
    const stmt = this.db.prepare(
      `SELECT ${BREAKER_TEST_COLS} FROM breaker_tests
       WHERE breaker_id = ?
       ORDER BY tested_at DESC, id DESC
       LIMIT 1`
    );
    for (const id of breakerIds) {
      const row = stmt.get(id) as BreakerTestRow | undefined;
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

export class SqliteServiceEntryRepository implements ServiceEntryRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(
    filter?: ServiceEntryListFilter
  ): Promise<ServiceEntryListResult> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.parentType !== undefined) {
      where.push('parent_type = ?');
      params.push(filter.parentType);
    }
    if (filter?.parentId !== undefined) {
      where.push('parent_id = ?');
      params.push(filter.parentId);
    }
    if (filter?.parentIds !== undefined && filter.parentIds.length > 0) {
      const placeholders = filter.parentIds.map(() => '?').join(',');
      where.push(`parent_id IN (${placeholders})`);
      for (const id of filter.parentIds) params.push(id);
    }
    if (filter?.since !== undefined) {
      where.push('occurred_at >= ?');
      params.push(filter.since);
    }
    if (filter?.until !== undefined) {
      where.push('occurred_at <= ?');
      params.push(filter.until);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM service_entries ${whereClause}`)
      .get(...params) as { count: number } | undefined;
    const totalCount = totalRow?.count ?? 0;

    let sql = `SELECT ${SERVICE_ENTRY_COLS} FROM service_entries
      ${whereClause}
      ORDER BY occurred_at DESC, id DESC`;
    const queryParams = [...params];
    if (filter?.limit !== undefined) {
      sql += ' LIMIT ?';
      queryParams.push(filter.limit);
    }
    const rows = this.db.prepare(sql).all(...queryParams) as ServiceEntryRow[];
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
    this.db
      .prepare(
        `INSERT INTO service_entries (${SERVICE_ENTRY_COLS})
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.parentType,
        entry.parentId,
        entry.occurredAt,
        entry.note,
        entry.createdAt
      );
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM service_entries WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}

// ── SqliteAppUserRepository (single-user login sign-up flow) ──────────────

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

export class SqliteAppUserRepository implements AppUserRepository {
  constructor(private readonly db: DatabaseSync) {}

  hasAnyUser(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM app_users')
      .get() as { n: number };
    return row.n > 0;
  }

  getSingle(): AppUser | null {
    const row = this.db
      .prepare(
        'SELECT id, username, password_hash, created_at FROM app_users LIMIT 1'
      )
      .get() as AppUserRow | undefined;
    return row === undefined ? null : rowToAppUser(row);
  }

  getByUsername(username: string): AppUser | null {
    const row = this.db
      .prepare(
        'SELECT id, username, password_hash, created_at FROM app_users WHERE username = ?'
      )
      .get(username) as AppUserRow | undefined;
    return row === undefined ? null : rowToAppUser(row);
  }

  create(input: { username: string; passwordHash: string }): AppUser {
    // Wrap in a transaction so the "no user yet" check + INSERT can't
    // race with a parallel sign-up. SQLite serializes writes, but the
    // explicit transaction makes the invariant load-bearing and
    // greppable.
    this.db.exec('BEGIN');
    try {
      const existing = this.db
        .prepare('SELECT COUNT(*) AS n FROM app_users')
        .get() as { n: number };
      if (existing.n > 0) {
        this.db.exec('ROLLBACK');
        throw new Error('A user already exists.');
      }
      const id = newId();
      const createdAt = Date.now();
      this.db
        .prepare(
          `INSERT INTO app_users (id, username, password_hash, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, input.username, input.passwordHash, createdAt);
      this.db.exec('COMMIT');
      return {
        id,
        username: input.username,
        passwordHash: input.passwordHash,
        createdAt,
      };
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw e;
    }
  }

  updatePasswordHash(id: string, passwordHash: string): void {
    const result = this.db
      .prepare('UPDATE app_users SET password_hash = ? WHERE id = ?')
      .run(passwordHash, id);
    if (result.changes === 0) {
      throw new Error('User not found.');
    }
  }
}
