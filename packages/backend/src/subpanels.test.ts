/**
 * G39 cycle-56 — subpanel hierarchy tests.
 *
 * Covers: panels.parent_breaker_id POST/PATCH happy path, cycle detection,
 * self-feed rejection, and the breaker-delete belt-and-suspenders detach.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
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

type PanelLike = {
  id: string;
  name: string;
  parentBreakerId: string | null;
};

describe('subpanel hierarchy (G39)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;

  const json = async <T,>(res: Response): Promise<T> =>
    (await res.json()) as T;

  const createPanel = async (
    name: string,
    extra?: { parentBreakerId?: string | null }
  ): Promise<PanelLike> => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, ...extra }),
    });
    assert.equal(res.status, 201);
    const body = await json<{ data: PanelLike }>(res);
    return body.data;
  };

  const createBreaker = async (
    panelId: string,
    overrides?: Partial<{
      slot: string;
      amperage: number;
      poles: 'single' | 'double' | 'tandem';
      label: string;
      slotPosition: number;
      tandemHalf: 'a' | 'b' | null;
    }>
  ): Promise<{ id: string; panelId: string }> => {
    const res = await app.request(
      `/api/v1/panels/${encodeURIComponent(panelId)}/breakers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slot: '1',
          amperage: 60,
          poles: 'double',
          label: 'Subpanel feeder',
          slotPosition: 1,
          ...overrides,
        }),
      }
    );
    if (res.status !== 201) {
      const text = await res.text();
      throw new Error(`create breaker failed: ${res.status} ${text}`);
    }
    const body = await json<{ data: { id: string; panelId: string } }>(res);
    return body.data;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-sub-'));
    db = openDatabase(join(dir, 'srv.db'));
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
      auth: null,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST /panels accepts parentBreakerId, GET returns it', async () => {
    const main = await createPanel('Main');
    assert.equal(main.parentBreakerId, null);
    const feeder = await createBreaker(main.id);
    const sub = await createPanel('Garage', { parentBreakerId: feeder.id });
    assert.equal(sub.parentBreakerId, feeder.id);

    // Round-trip GET confirms persistence.
    const res = await app.request(`/api/v1/panels/${sub.id}`);
    assert.equal(res.status, 200);
    const body = await json<{ data: PanelLike }>(res);
    assert.equal(body.data.parentBreakerId, feeder.id);
  });

  it('POST /panels rejects parentBreakerId that does not exist', async () => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Garage', parentBreakerId: 'fake-id' }),
    });
    assert.equal(res.status, 400);
    const body = await json<{ error: { message: string } }>(res);
    assert.match(body.error.message, /not found/i);
  });

  it('PATCH /panels/:id sets parentBreakerId to wire as subpanel', async () => {
    const main = await createPanel('Main');
    const sub = await createPanel('Garage');
    const feeder = await createBreaker(main.id);

    const res = await app.request(`/api/v1/panels/${sub.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: feeder.id }),
    });
    assert.equal(res.status, 200);
    const body = await json<{ data: PanelLike }>(res);
    assert.equal(body.data.parentBreakerId, feeder.id);
  });

  it('PATCH /panels/:id can detach by setting parentBreakerId to null', async () => {
    const main = await createPanel('Main');
    const feeder = await createBreaker(main.id);
    const sub = await createPanel('Garage', { parentBreakerId: feeder.id });
    assert.equal(sub.parentBreakerId, feeder.id);

    const res = await app.request(`/api/v1/panels/${sub.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: null }),
    });
    assert.equal(res.status, 200);
    const body = await json<{ data: PanelLike }>(res);
    assert.equal(body.data.parentBreakerId, null);
  });

  it('rejects self-feed: a panel cannot feed itself via its own breaker', async () => {
    const main = await createPanel('Main');
    const breaker = await createBreaker(main.id);

    const res = await app.request(`/api/v1/panels/${main.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: breaker.id }),
    });
    assert.equal(res.status, 400);
    const body = await json<{ error: { message: string } }>(res);
    assert.match(body.error.message, /can.?t feed itself/i);
  });

  it('rejects cycle: A→B→A', async () => {
    // Two panels A & B. Wire A as subpanel of B (B's breaker feeds A). Then
    // try to wire B as subpanel of A (A's breaker feeds B). That's a cycle.
    const a = await createPanel('A');
    const b = await createPanel('B');
    const bFeeder = await createBreaker(b.id);
    const aFeeder = await createBreaker(a.id);

    // A is fed by B. OK.
    const r1 = await app.request(`/api/v1/panels/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: bFeeder.id }),
    });
    assert.equal(r1.status, 200);

    // Now try: B is fed by A. Cycle: A.parent → B's breaker (B) → B.parent
    // would be A's breaker (A) → A.parent → B → … loop.
    const r2 = await app.request(`/api/v1/panels/${b.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: aFeeder.id }),
    });
    assert.equal(r2.status, 400);
    const body = await json<{ error: { message: string } }>(r2);
    assert.match(body.error.message, /loop|cycle/i);
  });

  it('rejects deeper cycle: A→B→C→A', async () => {
    const a = await createPanel('A');
    const b = await createPanel('B');
    const c = await createPanel('C');
    const aFeeder = await createBreaker(a.id);
    const bFeeder = await createBreaker(b.id);
    const cFeeder = await createBreaker(c.id);

    // Chain: A feeds B, B feeds C.
    const r1 = await app.request(`/api/v1/panels/${b.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: aFeeder.id }),
    });
    assert.equal(r1.status, 200);
    const r2 = await app.request(`/api/v1/panels/${c.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: bFeeder.id }),
    });
    assert.equal(r2.status, 200);

    // Now try: A fed by C — that would close the loop A → B → C → A.
    const r3 = await app.request(`/api/v1/panels/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: cFeeder.id }),
    });
    assert.equal(r3.status, 400);
    const body = await json<{ error: { message: string } }>(r3);
    assert.match(body.error.message, /loop|cycle/i);
  });

  it('deleting feeder breaker DETACHES the subpanel (SET NULL)', async () => {
    const main = await createPanel('Main');
    const feeder = await createBreaker(main.id);
    const sub = await createPanel('Garage', { parentBreakerId: feeder.id });
    assert.equal(sub.parentBreakerId, feeder.id);

    // Delete the feeder breaker.
    const del = await app.request(`/api/v1/breakers/${feeder.id}`, {
      method: 'DELETE',
    });
    assert.equal(del.status, 204);

    // The subpanel survives but parent_breaker_id is now null.
    const after = await app.request(`/api/v1/panels/${sub.id}`);
    assert.equal(after.status, 200);
    const body = await json<{ data: PanelLike }>(after);
    assert.equal(body.data.parentBreakerId, null);
  });

  it('deleting parent panel detaches children — children survive', async () => {
    const main = await createPanel('Main');
    const feeder = await createBreaker(main.id);
    const sub = await createPanel('Garage', { parentBreakerId: feeder.id });

    // Delete the parent panel (cascades to its breakers, which should
    // detach the subpanel via the belt-and-suspenders UPDATE).
    const del = await app.request(`/api/v1/panels/${main.id}`, {
      method: 'DELETE',
    });
    assert.equal(del.status, 204);

    const after = await app.request(`/api/v1/panels/${sub.id}`);
    assert.equal(after.status, 200);
    const body = await json<{ data: PanelLike }>(after);
    assert.equal(body.data.parentBreakerId, null);
    assert.equal(body.data.name, 'Garage');
  });
});
