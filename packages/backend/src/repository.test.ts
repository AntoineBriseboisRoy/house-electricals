import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from './db.js';
import {
  PgBreakerRepository,
  PgComponentRepository,
  PgFloorRepository,
  PgPanelRepository,
  PgRoomRepository,
} from './repository.js';
import { createTestDb } from './test-helpers.js';

/** Assert that `fn` rejects with a Postgres error carrying SQLSTATE `code`. */
const expectPgError = async (
  code: string,
  fn: () => Promise<unknown>
): Promise<void> => {
  try {
    await fn();
    assert.fail(`expected a Postgres error with SQLSTATE ${code}`);
  } catch (err) {
    assert.equal(
      (err as { code?: string }).code,
      code,
      `expected SQLSTATE ${code}, got ${(err as { code?: string }).code}`
    );
  }
};

describe('PgPanelRepository', () => {
  let cleanup: () => Promise<void>;
  let db: Db;
  let repo: PgPanelRepository;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    repo = new PgPanelRepository(db);
  });

  afterEach(async () => {
    await cleanup();
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
    const breakerRepo = new PgBreakerRepository(db);
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

describe('G42(a) cycle-49: UNIQUE name constraints (Postgres native)', () => {
  let cleanup: () => Promise<void>;
  let db: Db;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('rejects a duplicate panel name with a UNIQUE violation (23505)', async () => {
    const repo = new PgPanelRepository(db);
    await repo.create({ name: 'Dup' });
    await expectPgError('23505', () => repo.create({ name: 'Dup' }));
  });

  it('rejects a duplicate floor name with a UNIQUE violation (23505)', async () => {
    const repo = new PgFloorRepository(db);
    await repo.create({ name: 'Basement' });
    await expectPgError('23505', () => repo.create({ name: 'Basement' }));
  });

  it('rooms uniqueness is per (floor_id, name) — same name on different floors is allowed', async () => {
    const floors = new PgFloorRepository(db);
    const rooms = new PgRoomRepository(db);
    const f1 = await floors.create({ name: 'F1' });
    const f2 = await floors.create({ name: 'F2' });

    // 'Kitchen' on f1 — OK.
    await rooms.create(f1.id, { name: 'Kitchen', x: 0, y: 0, w: 100, h: 100 });
    // 'Kitchen' on f2 (different floor) — also OK.
    await rooms.create(f2.id, { name: 'Kitchen', x: 0, y: 0, w: 100, h: 100 });

    const f1Rooms = await rooms.listByFloor(f1.id);
    const f2Rooms = await rooms.listByFloor(f2.id);
    assert.equal(f1Rooms.length, 1);
    assert.equal(f2Rooms.length, 1);

    // A second 'Kitchen' on f1 — UNIQUE violation.
    await expectPgError('23505', () =>
      rooms.create(f1.id, { name: 'Kitchen', x: 200, y: 0, w: 100, h: 100 })
    );
  });
});

describe('G35 Part 2 cycle-59: components.critical column', () => {
  let cleanup: () => Promise<void>;
  let db: Db;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('a component created without `critical` defaults to 0 / false', async () => {
    const components = new PgComponentRepository(db);
    const c = await components.create({ type: 'outlet', name: 'Old' });
    assert.equal(c.critical, false, 'repo maps the default to false');

    const row = await db.queryOne<{ critical: number }>(
      'SELECT critical FROM components WHERE id = $1',
      [c.id]
    );
    assert.equal(row?.critical, 0, 'underlying column defaults to 0');
  });

  it('round-trips critical=true as 1 and back to true', async () => {
    const components = new PgComponentRepository(db);
    const c = await components.create({
      type: 'outlet',
      name: 'Critical outlet',
      critical: true,
    });
    assert.equal(c.critical, true);

    const row = await db.queryOne<{ critical: number }>(
      'SELECT critical FROM components WHERE id = $1',
      [c.id]
    );
    assert.equal(row?.critical, 1);
  });

  it('column has CHECK (critical IN (0,1)) — inserting 2 fails (23514)', async () => {
    // building_id is NOT NULL (2026-05); use the seeded default so the row
    // gets past NOT NULL and actually exercises the `critical` CHECK.
    await expectPgError('23514', () =>
      db.execute(
        `INSERT INTO components (id, type, name, gangs, critical, created_at, building_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'building_default')`,
        ['x-1', 'outlet', 'Bad', 1, 2, 1000]
      )
    );
  });
});
