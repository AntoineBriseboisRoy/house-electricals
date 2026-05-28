import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Component, Floor, Panel, ResolvedComponent } from '@he/shared';
import {
  openDatabase,
  SqliteBreakerRepository,
  SqliteBreakerTestRepository,
  SqliteComponentRepository,
  SqliteFloorRepository,
  SqlitePanelRepository,
  SqliteRoomRepository,
  SqliteServiceEntryRepository,
  SqliteWallRepository,
} from './repository.js';
import { buildApp } from './server.js';

describe('floor routes (G13)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-floors-'));
    db = openDatabase(join(dir, 'floors.db'));
    app = buildApp({
      panelRepository: new SqlitePanelRepository(db),
      breakerRepository: new SqliteBreakerRepository(db),
      breakerTestRepository: new SqliteBreakerTestRepository(db),
      componentRepository: new SqliteComponentRepository(db),
      floorRepository: new SqliteFloorRepository(db),
      wallRepository: new SqliteWallRepository(db),
      roomRepository: new SqliteRoomRepository(db),
      serviceEntryRepository: new SqliteServiceEntryRepository(db),
      db,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/v1/floors returns empty list initially', async () => {
    const res = await app.request('/api/v1/floors');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Floor[] };
    assert.deepEqual(body.data, []);
  });

  it('POST /api/v1/floors creates a floor', async () => {
    const res = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Basement', displayOrder: 0 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Floor };
    assert.equal(body.data.name, 'Basement');
    assert.equal(body.data.displayOrder, 0);
    assert.equal(body.data.floorPlan, null);
    assert.ok(body.data.id);
    assert.ok(body.data.createdAt > 0);
  });

  it('POST rejects empty name', async () => {
    const res = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(res.status, 400);
  });

  it('GET /api/v1/floors sorts by displayOrder ASC NULLS LAST, then created_at', async () => {
    const post = (body: unknown): Promise<Floor> =>
      app
        .request('/api/v1/floors', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        .then((r) => r.json() as Promise<{ data: Floor }>)
        .then((b) => b.data);

    const noOrder = await post({ name: 'No order' });
    const second = await post({ name: 'Second', displayOrder: 2 });
    const first = await post({ name: 'First', displayOrder: 1 });

    const res = await app.request('/api/v1/floors');
    const body = (await res.json()) as { data: Floor[] };
    assert.deepEqual(
      body.data.map((f) => f.id),
      [first.id, second.id, noOrder.id]
    );
  });

  it('GET /api/v1/floors/:id returns 404 for unknown id', async () => {
    const res = await app.request('/api/v1/floors/nope');
    assert.equal(res.status, 404);
  });

  it('PATCH /api/v1/floors/:id updates name and displayOrder', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', displayOrder: 0 }),
    });
    const { data } = (await create.json()) as { data: Floor };

    const patch = await app.request(`/api/v1/floors/${data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A renamed', displayOrder: 5 }),
    });
    assert.equal(patch.status, 200);
    const updated = (await patch.json()) as { data: Floor };
    assert.equal(updated.data.name, 'A renamed');
    assert.equal(updated.data.displayOrder, 5);
  });

  it('PATCH can clear displayOrder to null', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', displayOrder: 3 }),
    });
    const { data } = (await create.json()) as { data: Floor };
    const patch = await app.request(`/api/v1/floors/${data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayOrder: null }),
    });
    assert.equal(patch.status, 200);
    const updated = (await patch.json()) as { data: Floor };
    assert.equal(updated.data.displayOrder, null);
  });

  it('DELETE /api/v1/floors/:id removes the floor', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A' }),
    });
    const { data } = (await create.json()) as { data: Floor };

    const del = await app.request(`/api/v1/floors/${data.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const after = await app.request(`/api/v1/floors/${data.id}`);
    assert.equal(after.status, 404);
  });

  it('DELETE 404 for unknown id', async () => {
    const res = await app.request('/api/v1/floors/nope', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  it('US-002: delete a floor with components → components survive with floor_id=null', async () => {
    // 1. Create a panel + breaker so components can attach to electrical state
    const pres = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panel = ((await pres.json()) as { data: Panel }).data;

    const bres = await app.request(`/api/v1/panels/${panel.id}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'Kitchen' }),
    });
    const breaker = ((await bres.json()) as { data: { id: string } }).data;

    // 2. Create a floor
    const fres = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Basement' }),
    });
    const floor = ((await fres.json()) as { data: Floor }).data;

    // 3. Create 2 components attached to that floor + breaker
    const create = async (name: string): Promise<Component> => {
      const r = await app.request('/api/v1/components', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'outlet',
          name,
          breakerId: breaker.id,
          floorId: floor.id,
        }),
      });
      return ((await r.json()) as { data: Component }).data;
    };
    const c1 = await create('Outlet 1');
    const c2 = await create('Outlet 2');
    assert.equal(c1.floorId, floor.id);
    assert.equal(c2.floorId, floor.id);

    // 4. Delete the floor — components must survive with floor_id=null,
    // breaker_id preserved.
    const del = await app.request(`/api/v1/floors/${floor.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const list = await app.request('/api/v1/components');
    const survivors = ((await list.json()) as { data: ResolvedComponent[] }).data;
    assert.equal(survivors.length, 2);
    for (const c of survivors) {
      assert.equal(c.floorId, null, `${c.name} floor_id should be null`);
      assert.equal(c.breakerId, breaker.id, `${c.name} breaker_id preserved`);
    }
  });

  it('US-002: PATCH /api/v1/components/:id accepts floorId (set + null)', async () => {
    const pres = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panel = ((await pres.json()) as { data: Panel }).data;
    const bres = await app.request(`/api/v1/panels/${panel.id}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'Kitchen' }),
    });
    const breaker = ((await bres.json()) as { data: { id: string } }).data;
    const cres = await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'outlet', name: 'X', breakerId: breaker.id }),
    });
    const comp = ((await cres.json()) as { data: Component }).data;
    assert.equal(comp.floorId, null);

    const fres = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'F' }),
    });
    const floor = ((await fres.json()) as { data: Floor }).data;

    const patch1 = await app.request(`/api/v1/components/${comp.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floorId: floor.id }),
    });
    assert.equal(patch1.status, 200);
    const after1 = ((await patch1.json()) as { data: Component }).data;
    assert.equal(after1.floorId, floor.id);

    const patch2 = await app.request(`/api/v1/components/${comp.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floorId: null }),
    });
    assert.equal(patch2.status, 200);
    const after2 = ((await patch2.json()) as { data: Component }).data;
    assert.equal(after2.floorId, null);
  });

  it('US-002: GET /api/v1/components?floorId=<id> filters to that floor', async () => {
    const pres = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panel = ((await pres.json()) as { data: Panel }).data;
    const bres = await app.request(`/api/v1/panels/${panel.id}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'K' }),
    });
    const breaker = ((await bres.json()) as { data: { id: string } }).data;
    const f1 = await app
      .request('/api/v1/floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'F1' }),
      })
      .then((r) => r.json() as Promise<{ data: Floor }>)
      .then((b) => b.data);
    const f2 = await app
      .request('/api/v1/floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'F2' }),
      })
      .then((r) => r.json() as Promise<{ data: Floor }>)
      .then((b) => b.data);

    const mkComp = async (floorId: string | null, name: string): Promise<void> => {
      await app.request('/api/v1/components', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'outlet', name, breakerId: breaker.id, floorId }),
      });
    };
    await mkComp(f1.id, 'A');
    await mkComp(f1.id, 'B');
    await mkComp(f2.id, 'C');
    await mkComp(null, 'D');

    const r = await app.request(`/api/v1/components?floorId=${f1.id}`);
    const list = ((await r.json()) as { data: ResolvedComponent[] }).data;
    assert.deepEqual(
      list.map((c) => c.name).sort(),
      ['A', 'B']
    );
  });

  // === G42(a) cycle-49 — UNIQUE floors(name) ================================

  it('G42(a): POST duplicate floor name returns 409', async () => {
    const r1 = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Basement' }),
    });
    assert.equal(r1.status, 201);
    const r2 = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Basement' }),
    });
    assert.equal(r2.status, 409);
    const body = (await r2.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken/);
    assert.match(body.error.message, /Basement/);
  });

  it('G42(a): PATCH renaming a floor to an existing name returns 409', async () => {
    const mk = async (name: string): Promise<{ id: string }> => {
      const r = await app.request('/api/v1/floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return ((await r.json()) as { data: { id: string } }).data;
    };
    const a = await mk('Alpha');
    await mk('Beta');
    const patch = await app.request(`/api/v1/floors/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Beta' }),
    });
    assert.equal(patch.status, 409);
  });

  it('happy-path: create → list → get → patch → delete', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main', displayOrder: 1 }),
    });
    const created = ((await create.json()) as { data: Floor }).data;

    const list = await app.request('/api/v1/floors');
    const listed = ((await list.json()) as { data: Floor[] }).data;
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.id);

    const get = await app.request(`/api/v1/floors/${created.id}`);
    assert.equal(get.status, 200);

    const patch = await app.request(`/api/v1/floors/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main Floor' }),
    });
    assert.equal(patch.status, 200);

    const del = await app.request(`/api/v1/floors/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
  });
});

describe('G13 backfill migration (US-003)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-migr-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds a pre-G13 state via raw SQL, then reopens to trigger backfill', () => {
    const dbPath = join(dir, 'migr.db');
    const db1 = openDatabase(dbPath);

    // Build a panel + breaker + 2 components via the public API
    // (the SqlitePanelRepository writes panel rows we can later mutate).
    const panelRepo = new SqlitePanelRepository(db1);
    const breakerRepo = new SqliteBreakerRepository(db1);
    const componentRepo = new SqliteComponentRepository(db1);
    let p: { id: string } | null = null;
    let breakerId = '';
    return Promise.resolve()
      .then(() => panelRepo.create({ name: 'Basement panel' }))
      .then((panel) => {
        p = panel;
        return breakerRepo.create(panel.id, {
          slot: '1',
          amperage: 20,
          poles: 'single',
          label: 'Lights',
        });
      })
      .then((b) => {
        breakerId = b.id;
        return componentRepo.create({
          type: 'outlet',
          name: 'A',
          breakerId,
        });
      })
      .then(() =>
        componentRepo.create({
          type: 'outlet',
          name: 'B',
          breakerId,
        })
      )
      .then(() => {
        // Simulate pre-migration state:
        //   - floors table empty
        //   - components.floor_id NULL
        //   - panel has legacy floor_plan_filename + dimensions
        db1.prepare('DELETE FROM floors').run();
        db1.prepare('UPDATE components SET floor_id = NULL').run();
        db1
          .prepare(
            'UPDATE panels SET floor_plan_filename = ?, image_width = ?, image_height = ? WHERE id = ?'
          )
          .run('legacy-file.png', 800, 600, p!.id);

        db1.close();

        // Reopen — backfill runs because floors is empty AND panel has plan.
        const db2 = openDatabase(dbPath);
        try {
          type FloorRow = {
            id: string;
            name: string;
            floor_plan_filename: string | null;
            floor_plan_width: number | null;
            floor_plan_height: number | null;
          };
          const floors = db2
            .prepare(
              'SELECT id, name, floor_plan_filename, floor_plan_width, floor_plan_height FROM floors'
            )
            .all() as FloorRow[];
          assert.equal(floors.length, 1, 'exactly one floor created by backfill');
          assert.equal(
            floors[0]?.name,
            'Basement panel',
            'floor name inherited from panel name (NOT "Main floor")'
          );
          assert.equal(floors[0]?.floor_plan_filename, 'legacy-file.png');
          assert.equal(floors[0]?.floor_plan_width, 800);
          assert.equal(floors[0]?.floor_plan_height, 600);

          type CompRow = { name: string; floor_id: string | null };
          const comps = db2
            .prepare('SELECT name, floor_id FROM components ORDER BY name')
            .all() as CompRow[];
          assert.equal(comps.length, 2);
          assert.equal(comps[0]?.floor_id, floors[0]?.id, 'A linked');
          assert.equal(comps[1]?.floor_id, floors[0]?.id, 'B linked');
        } finally {
          db2.close();
        }
      });
  });

  it('is idempotent — running twice does not duplicate floors', () => {
    const dbPath = join(dir, 'idem.db');
    const db1 = openDatabase(dbPath);

    const panelRepo = new SqlitePanelRepository(db1);
    return panelRepo
      .create({ name: 'P' })
      .then((p) => {
        db1
          .prepare(
            'UPDATE panels SET floor_plan_filename = ?, image_width = ?, image_height = ? WHERE id = ?'
          )
          .run('plan.png', 100, 100, p.id);
        db1.close();

        // First reopen — backfill runs
        const db2 = openDatabase(dbPath);
        const count1 = (
          db2.prepare('SELECT COUNT(*) AS n FROM floors').get() as { n: number }
        ).n;
        db2.close();
        assert.equal(count1, 1);

        // Second reopen — gate says "floors non-empty" → skip
        const db3 = openDatabase(dbPath);
        const count2 = (
          db3.prepare('SELECT COUNT(*) AS n FROM floors').get() as { n: number }
        ).n;
        db3.close();
        assert.equal(count2, 1, 'idempotent — still exactly 1 floor');
      });
  });
});

// Cycle-85 — floors.panel_id link tests.
describe('cycle-85: floors.panel_id link', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  let panelId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-floors-panel-'));
    db = openDatabase(join(dir, 'floors.db'));
    app = buildApp({
      panelRepository: new SqlitePanelRepository(db),
      breakerRepository: new SqliteBreakerRepository(db),
      breakerTestRepository: new SqliteBreakerTestRepository(db),
      componentRepository: new SqliteComponentRepository(db),
      floorRepository: new SqliteFloorRepository(db),
      wallRepository: new SqliteWallRepository(db),
      roomRepository: new SqliteRoomRepository(db),
      serviceEntryRepository: new SqliteServiceEntryRepository(db),
      db,
    });
    const r = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main Panel' }),
    });
    panelId = ((await r.json()) as { data: Panel }).data.id;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Floor row defaults panelId to null', async () => {
    const res = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Basement' }),
    });
    const body = (await res.json()) as { data: Floor };
    assert.equal(body.data.panelId, null);
  });

  it('POST /api/v1/floors with valid panelId persists the link', async () => {
    const res = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main floor', panelId }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Floor };
    assert.equal(body.data.panelId, panelId);
  });

  it('POST /api/v1/floors with unknown panelId returns 404', async () => {
    const res = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main', panelId: 'bogus-id' }),
    });
    assert.equal(res.status, 404);
  });

  it('PATCH /api/v1/floors/:id updates panelId (set + clear)', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Top' }),
    });
    const floor = ((await create.json()) as { data: Floor }).data;

    const link = await app.request(`/api/v1/floors/${floor.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId }),
    });
    assert.equal(link.status, 200);
    const linked = ((await link.json()) as { data: Floor }).data;
    assert.equal(linked.panelId, panelId);

    const clear = await app.request(`/api/v1/floors/${floor.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: null }),
    });
    const cleared = ((await clear.json()) as { data: Floor }).data;
    assert.equal(cleared.panelId, null);
  });

  it('PATCH /api/v1/floors/:id with unknown panelId returns 404', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const floor = ((await create.json()) as { data: Floor }).data;
    const res = await app.request(`/api/v1/floors/${floor.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: 'nope' }),
    });
    assert.equal(res.status, 404);
  });

  it('DELETE panel → floor.panelId becomes null (ON DELETE SET NULL)', async () => {
    const create = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Linked', panelId }),
    });
    const floor = ((await create.json()) as { data: Floor }).data;
    assert.equal(floor.panelId, panelId);

    const del = await app.request(`/api/v1/panels/${panelId}`, {
      method: 'DELETE',
    });
    assert.equal(del.status, 204);

    const get = await app.request(`/api/v1/floors/${floor.id}`);
    const after = ((await get.json()) as { data: Floor }).data;
    assert.equal(after.panelId, null);
  });
});
