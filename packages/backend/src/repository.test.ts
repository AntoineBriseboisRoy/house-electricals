import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, SqliteBreakerRepository, SqlitePanelRepository } from './repository.js';

describe('SqlitePanelRepository', () => {
  let dir: string;
  let db: DatabaseSync;
  let repo: SqlitePanelRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-repo-'));
    db = openDatabase(join(dir, 'test.db'));
    repo = new SqlitePanelRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists empty initially', async () => {
    assert.deepEqual(await repo.list(), []);
  });

  it('persists a created panel and returns it from list', async () => {
    const created = await repo.create({ name: 'Main panel' });
    assert.equal(created.name, 'Main panel');
    assert.match(created.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(typeof created.createdAt, 'number');

    const all = await repo.list();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], created);
  });

  it('preserves insertion order across multiple panels', async () => {
    const a = await repo.create({ name: 'A' });
    const b = await repo.create({ name: 'B' });
    const c = await repo.create({ name: 'C' });

    const all = await repo.list();
    assert.deepEqual(
      all.map((p) => p.name),
      ['A', 'B', 'C']
    );
    assert.deepEqual(
      all.map((p) => p.id),
      [a.id, b.id, c.id]
    );
  });

  it('gets a panel by id (hit and miss)', async () => {
    const p = await repo.create({ name: 'X' });
    assert.deepEqual(await repo.get(p.id), p);
    assert.equal(await repo.get('nonexistent'), null);
  });

  it('deletes a panel by id (hit returns true, miss returns false)', async () => {
    const p = await repo.create({ name: 'D' });
    assert.equal(await repo.delete(p.id), true);
    assert.equal(await repo.get(p.id), null);
    assert.equal(await repo.delete('nonexistent'), false);
  });

  it('panel delete cascades to its breakers', async () => {
    const breakerRepo = new SqliteBreakerRepository(db);
    const p = await repo.create({ name: 'P' });
    await breakerRepo.create(p.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'Kitchen',
    });
    await breakerRepo.create(p.id, {
      slot: '2',
      amperage: 15,
      poles: 'single',
      label: 'Living room',
    });
    assert.equal((await breakerRepo.listByPanel(p.id)).length, 2);

    await repo.delete(p.id);
    assert.equal((await breakerRepo.listByPanel(p.id)).length, 0);
  });
});

describe('G42(a) cycle-49: UNIQUE name migration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-uniq-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('auto-suffixes pre-existing duplicate panel names with " (N)" before adding UNIQUE index', () => {
    const dbPath = join(dir, 'uniq.db');
    // Open the DB once so the schema exists, then DROP the UNIQUE index and
    // manually re-insert duplicates to simulate pre-migration state.
    const db1 = openDatabase(dbPath);
    // Sanity: the index was created on first open.
    type IxRow = { name: string };
    const indexesBefore = db1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_unique_%'"
      )
      .all() as IxRow[];
    assert.ok(
      indexesBefore.some((i) => i.name === 'idx_unique_panels_name'),
      'index created on first open'
    );
    // Drop the index so we can insert duplicates legally.
    db1.exec('DROP INDEX idx_unique_panels_name');
    db1.exec('DROP INDEX idx_unique_floors_name');
    db1.exec('DROP INDEX idx_unique_rooms_floor_name');
    // Insert 3 panels named 'Dup' with deterministic created_at values.
    const ins = db1.prepare(
      'INSERT INTO panels (id, name, created_at, orientation, slot_count) VALUES (?, ?, ?, ?, ?)'
    );
    ins.run('p-1', 'Dup', 1000, 'vertical', 24);
    ins.run('p-2', 'Dup', 2000, 'vertical', 24);
    ins.run('p-3', 'Dup', 3000, 'vertical', 24);
    db1.close();

    // Reopen — ensureUniqueNames sees the dropped indexes and runs dedup
    // + CREATE INDEX again. The 3 'Dup' rows should resolve to 'Dup',
    // 'Dup (2)', 'Dup (3)'.
    const db2 = openDatabase(dbPath);
    try {
      type Row = { id: string; name: string };
      const rows = db2
        .prepare(
          "SELECT id, name FROM panels WHERE id LIKE 'p-%' ORDER BY created_at ASC, id ASC"
        )
        .all() as Row[];
      assert.deepEqual(
        rows.map((r) => r.name),
        ['Dup', 'Dup (2)', 'Dup (3)'],
        'first row keeps name; subsequent get " (2)" / " (3)"'
      );

      // Re-inserting a 4th 'Dup' should now fail with UNIQUE violation.
      let threw = false;
      try {
        db2
          .prepare(
            'INSERT INTO panels (id, name, created_at, orientation, slot_count) VALUES (?, ?, ?, ?, ?)'
          )
          .run('p-4', 'Dup', 4000, 'vertical', 24);
      } catch {
        threw = true;
      }
      assert.equal(threw, true, 'index is active — duplicate INSERT rejected');
    } finally {
      db2.close();
    }
  });

  it('is idempotent — re-running openDatabase does not re-suffix already-fixed rows', () => {
    const dbPath = join(dir, 'idem.db');
    // First open creates the indexes (no duplicates to fix).
    const db1 = openDatabase(dbPath);
    const ins = db1.prepare(
      'INSERT INTO panels (id, name, created_at, orientation, slot_count) VALUES (?, ?, ?, ?, ?)'
    );
    ins.run('q-1', 'Once', 1000, 'vertical', 24);
    db1.close();

    // Second open: indexes exist → bail. The single 'Once' row is unchanged.
    const db2 = openDatabase(dbPath);
    try {
      type Row = { name: string };
      const rows = db2.prepare("SELECT name FROM panels WHERE id = 'q-1'").all() as Row[];
      assert.deepEqual(rows.map((r) => r.name), ['Once']);
    } finally {
      db2.close();
    }
  });

  it('handles the case where the candidate suffix ALSO collides ("Foo", "Foo", "Foo (2)" → counter skips to 3)', () => {
    const dbPath = join(dir, 'collide.db');
    const db1 = openDatabase(dbPath);
    db1.exec('DROP INDEX idx_unique_panels_name');
    db1.exec('DROP INDEX idx_unique_floors_name');
    db1.exec('DROP INDEX idx_unique_rooms_floor_name');
    const ins = db1.prepare(
      'INSERT INTO panels (id, name, created_at, orientation, slot_count) VALUES (?, ?, ?, ?, ?)'
    );
    ins.run('c-1', 'Foo', 1000, 'vertical', 24);
    ins.run('c-2', 'Foo', 2000, 'vertical', 24);
    ins.run('c-3', 'Foo (2)', 3000, 'vertical', 24);
    db1.close();

    const db2 = openDatabase(dbPath);
    try {
      type Row = { id: string; name: string };
      const rows = db2
        .prepare(
          "SELECT id, name FROM panels WHERE id LIKE 'c-%' ORDER BY created_at ASC, id ASC"
        )
        .all() as Row[];
      assert.deepEqual(
        rows.map((r) => `${r.id}=${r.name}`),
        ['c-1=Foo', 'c-2=Foo (3)', 'c-3=Foo (2)'],
        'c-2 had to skip " (2)" because c-3 already used it'
      );
    } finally {
      db2.close();
    }
  });

  it('rooms uniqueness is per (floor_id, name) — same name on different floors survives', () => {
    const dbPath = join(dir, 'rooms.db');
    const db1 = openDatabase(dbPath);
    db1.exec('DROP INDEX idx_unique_rooms_floor_name');
    // Need two floors first (FK NOT NULL).
    const insF = db1.prepare(
      'INSERT INTO floors (id, name, created_at) VALUES (?, ?, ?)'
    );
    insF.run('f-1', 'F1', 1000);
    insF.run('f-2', 'F2', 2000);
    const insR = db1.prepare(
      'INSERT INTO rooms (id, floor_id, name, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // Two rooms named 'Kitchen' on f-1 (dup, will be suffixed).
    insR.run('r-1', 'f-1', 'Kitchen', 0, 0, 100, 100, 1000);
    insR.run('r-2', 'f-1', 'Kitchen', 200, 0, 100, 100, 2000);
    // One room named 'Kitchen' on f-2 (different floor — should survive).
    insR.run('r-3', 'f-2', 'Kitchen', 0, 0, 100, 100, 3000);
    db1.close();

    const db2 = openDatabase(dbPath);
    try {
      type Row = { id: string; name: string; floor_id: string };
      const rows = db2
        .prepare("SELECT id, name, floor_id FROM rooms ORDER BY created_at ASC, id ASC")
        .all() as Row[];
      assert.deepEqual(
        rows.map((r) => `${r.id}=${r.floor_id}:${r.name}`),
        ['r-1=f-1:Kitchen', 'r-2=f-1:Kitchen (2)', 'r-3=f-2:Kitchen'],
        'cross-floor "Kitchen" preserved; same-floor dup gets " (2)"'
      );
    } finally {
      db2.close();
    }
  });
});

describe('G35 Part 2 cycle-59: components.critical migration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-critical-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pre-existing rows without the column get critical=0 after migration', () => {
    const dbPath = join(dir, 'crit.db');
    // First open lays down the schema with critical column.
    const db1 = openDatabase(dbPath);
    // Drop the column to simulate a pre-G35-Part-2 DB. SQLite supports
    // DROP COLUMN in modern versions; if not, fall back to a table rebuild
    // without the column.
    db1.exec('ALTER TABLE components DROP COLUMN critical;');
    // Insert a row using the legacy schema (no critical).
    db1
      .prepare(
        `INSERT INTO components (id, type, name, room, notes, breaker_id, floor_id, pos_x, pos_y, gangs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('legacy-1', 'outlet', 'Old', null, null, null, null, null, null, 1, 1000);
    db1.close();

    // Reopen — ensureColumn re-adds the column with DEFAULT 0.
    const db2 = openDatabase(dbPath);
    try {
      type Row = { id: string; critical: number };
      const row = db2
        .prepare("SELECT id, critical FROM components WHERE id = 'legacy-1'")
        .get() as Row;
      assert.equal(row.critical, 0, 'pre-existing row defaults to 0');
    } finally {
      db2.close();
    }
  });

  it('column has CHECK(critical IN (0,1)) — INSERTing 2 fails', () => {
    const dbPath = join(dir, 'check.db');
    const db = openDatabase(dbPath);
    try {
      let threw = false;
      try {
        db.prepare(
          `INSERT INTO components (id, type, name, gangs, critical, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run('x-1', 'outlet', 'Bad', 1, 2, 1000);
      } catch {
        threw = true;
      }
      assert.equal(threw, true, 'CHECK constraint rejects critical=2');
    } finally {
      db.close();
    }
  });
});
