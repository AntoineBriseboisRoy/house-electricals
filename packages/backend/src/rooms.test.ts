import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Floor, Room } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

describe('room routes (G12)', () => {
  let cleanup: () => Promise<void>;
  let db: Db;
  let app: Hono;
  let floorId: string;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
    const r = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main' }),
    });
    floorId = ((await r.json()) as { data: { id: string } }).data.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('GET empty list initially', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Room[] };
    assert.deepEqual(body.data, []);
  });

  it('GET on missing floor returns 404', async () => {
    const res = await app.request('/api/v1/floors/nope/rooms');
    assert.equal(res.status, 404);
  });

  it('POST creates a room', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen', x: 1000, y: 1000, w: 4000, h: 3000 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Room };
    assert.equal(body.data.floorId, floorId);
    assert.equal(body.data.name, 'Kitchen');
    assert.deepEqual(
      { x: body.data.x, y: body.data.y, w: body.data.w, h: body.data.h },
      { x: 1000, y: 1000, w: 4000, h: 3000 }
    );
    // A rectangle room is stored as a 4-point axis-aligned polygon.
    assert.deepEqual(body.data.points, [
      { x: 1000, y: 1000 },
      { x: 5000, y: 1000 },
      { x: 5000, y: 4000 },
      { x: 1000, y: 4000 },
    ]);
  });

  it('POST creates a polygon (wall-loop) room and derives its bbox', async () => {
    // An L-shaped 6-vertex polygon (e.g. closed from a wall loop).
    const points = [
      { x: 1000, y: 1000 },
      { x: 5000, y: 1000 },
      { x: 5000, y: 3000 },
      { x: 3000, y: 3000 },
      { x: 3000, y: 5000 },
      { x: 1000, y: 5000 },
    ];
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'L-room', points }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Room };
    assert.deepEqual(body.data.points, points);
    // bbox = min/max of the polygon.
    assert.deepEqual(
      { x: body.data.x, y: body.data.y, w: body.data.w, h: body.data.h },
      { x: 1000, y: 1000, w: 4000, h: 4000 }
    );
  });

  it('POST rejects a polygon with < 3 points', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Degenerate', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }),
    });
    assert.equal(res.status, 400);
  });

  it('PATCH points reshapes the polygon and recomputes the bbox', async () => {
    const create = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Reshape', x: 0, y: 0, w: 2000, h: 2000 }),
    });
    const id = ((await create.json()) as { data: Room }).data.id;
    const nextPoints = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const res = await app.request(`/api/v1/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: nextPoints }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Room };
    assert.deepEqual(body.data.points, nextPoints);
    assert.deepEqual(
      { x: body.data.x, y: body.data.y, w: body.data.w, h: body.data.h },
      { x: 0, y: 0, w: 6000, h: 2000 }
    );
  });

  it('PATCH name-only leaves the polygon untouched', async () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 1000 },
      { x: 1500, y: 2500 },
      { x: 0, y: 1000 },
    ];
    const create = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pentagon', points }),
    });
    const id = ((await create.json()) as { data: Room }).data.id;
    const res = await app.request(`/api/v1/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pentagon renamed' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Room };
    assert.equal(body.data.name, 'Pentagon renamed');
    assert.deepEqual(body.data.points, points);
  });

  it('POST on missing floor returns 404', async () => {
    const res = await app.request('/api/v1/floors/nope/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 0, y: 0, w: 100, h: 100 }),
    });
    assert.equal(res.status, 404);
  });

  it('POST rejects empty name', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', x: 0, y: 0, w: 100, h: 100 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects zero-width rectangle', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 0, y: 0, w: 0, h: 100 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects out-of-range coords', async () => {
    // x beyond the widened COORD_MAX (100000); width beyond ROOM_DIM_MAX
    // (200000) would also reject. The legacy 0..10000 cap is gone.
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 100001, y: 0, w: 100, h: 100 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST accepts coords beyond the legacy 0–10000 window', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Far room', x: -2000, y: 12000, w: 30000, h: 400 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { x: number; y: number; w: number } };
    assert.equal(body.data.x, -2000);
    assert.equal(body.data.y, 12000);
    assert.equal(body.data.w, 30000);
  });

  it('PATCH partial updates only supplied fields, preserves floor_id', async () => {
    const r = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 100, y: 200, w: 300, h: 400 }),
    });
    const room = ((await r.json()) as { data: Room }).data;

    const p = await app.request(`/api/v1/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A renamed', w: 999 }),
    });
    assert.equal(p.status, 200);
    const updated = ((await p.json()) as { data: Room }).data;
    assert.equal(updated.name, 'A renamed');
    assert.equal(updated.w, 999);
    assert.equal(updated.x, 100);
    assert.equal(updated.y, 200);
    assert.equal(updated.h, 400);
    assert.equal(updated.floorId, floorId, 'floor_id never changes via PATCH');
  });

  it('DELETE removes a room', async () => {
    const r = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 0, y: 0, w: 100, h: 100 }),
    });
    const room = ((await r.json()) as { data: Room }).data;
    const d = await app.request(`/api/v1/rooms/${room.id}`, { method: 'DELETE' });
    assert.equal(d.status, 204);
    const after = await app.request(`/api/v1/rooms/${room.id}`);
    assert.equal(after.status, 404);
  });

  it('floor delete cascades to delete its rooms', async () => {
    const fres = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Disposable' }),
    });
    const floor = ((await fres.json()) as { data: Floor }).data;
    await app.request(`/api/v1/floors/${floor.id}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', x: 0, y: 0, w: 100, h: 100 }),
    });
    await app.request(`/api/v1/floors/${floor.id}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', x: 200, y: 200, w: 100, h: 100 }),
    });

    const del = await app.request(`/api/v1/floors/${floor.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const row = await db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM rooms WHERE floor_id = $1',
      [floor.id]
    );
    assert.equal(Number(row?.n), 0, 'rooms cascaded with floor');
  });

  it('G14 parity: pin PATCH on a vector-only floor (no image) works identically to image floor', async () => {
    // Pre-G14: a component placed on a floor REQUIRED an uploaded image
    // (because the PanelMapScreen drag-place UX gated on image presence).
    // After G14: components can be placed on a vector-only floor (walls/
    // rooms drawn, no image). This test exercises the data path that
    // PanelMapScreen drag-place hits, on a floor with floorPlan === null.
    //
    // Steps:
    //  1. Create panel + breaker (no image upload)
    //  2. Create a component on that breaker (no floor, no pos)
    //  3. PATCH the component with floorId + posX + posY in one call
    //     (the exact shape PanelMapScreen's handleDrop sends)
    //  4. Re-fetch and assert floorId/posX/posY landed; floor still
    //     has no floor_plan_filename
    const pres = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panel = ((await pres.json()) as { data: { id: string } }).data;
    const bres = await app.request(`/api/v1/panels/${panel.id}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'K' }),
    });
    const breaker = ((await bres.json()) as { data: { id: string } }).data;
    const cres = await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'outlet', name: 'X', breakerId: breaker.id }),
    });
    const comp = ((await cres.json()) as { data: { id: string; floorId: string | null; posX: number | null; posY: number | null } }).data;
    assert.equal(comp.floorId, null);
    assert.equal(comp.posX, null);
    assert.equal(comp.posY, null);

    // The pre-existing floor (created in beforeEach) has NO floor_plan_filename
    // by default — exactly the vector-only case we want.

    // Drop the pin on the vector-only floor — exactly what PanelMapScreen
    // handleDrop posts after a successful drag-release.
    const drop = await app.request(`/api/v1/components/${comp.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floorId, posX: 5000, posY: 5000 }),
    });
    assert.equal(drop.status, 200);
    const placed = ((await drop.json()) as { data: { floorId: string | null; posX: number | null; posY: number | null } }).data;
    assert.equal(placed.floorId, floorId);
    assert.equal(placed.posX, 5000);
    assert.equal(placed.posY, 5000);

    // Reposition (drag-place existing pin).
    const move = await app.request(`/api/v1/components/${comp.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posX: 7500, posY: 2500 }),
    });
    assert.equal(move.status, 200);
    const moved = ((await move.json()) as { data: { posX: number | null; posY: number | null; floorId: string | null } }).data;
    assert.equal(moved.posX, 7500);
    assert.equal(moved.posY, 2500);
    assert.equal(moved.floorId, floorId, 'reposition preserves floorId');

    // Remove from map (set both pos to null).
    const remove = await app.request(`/api/v1/components/${comp.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posX: null, posY: null }),
    });
    assert.equal(remove.status, 200);
    const removed = ((await remove.json()) as { data: { posX: number | null; posY: number | null; floorId: string | null } }).data;
    assert.equal(removed.posX, null);
    assert.equal(removed.posY, null);
    assert.equal(removed.floorId, floorId, 'remove-from-map keeps floorId; only clears pos');

    // Confirm the host floor still has no image.
    const floorRes = await app.request(`/api/v1/floors/${floorId}`);
    const floor = ((await floorRes.json()) as { data: { floorPlan: unknown } }).data;
    assert.equal(floor.floorPlan, null, 'floor has no image — this was a vector-only placement');
  });

  // === G42(a) cycle-49 — UNIQUE (floor_id, name) ============================

  it('G42(a): POST duplicate room name on same floor returns 409 with "is already taken"', async () => {
    const make = async (name: string): Promise<Response> =>
      app.request(`/api/v1/floors/${floorId}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, x: 0, y: 0, w: 100, h: 100 }),
      });
    const r1 = await make('Kitchen');
    assert.equal(r1.status, 201);
    const r2 = await make('Kitchen');
    assert.equal(r2.status, 409);
    const body = (await r2.json()) as { error: { message: string } };
    assert.match(body.error.message, /is already taken/);
    assert.match(body.error.message, /Kitchen/);
  });

  it('G42(a): rooms with same name on DIFFERENT floors are allowed', async () => {
    const fres = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Upstairs' }),
    });
    const otherFloor = ((await fres.json()) as { data: { id: string } }).data;

    const a = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bathroom', x: 0, y: 0, w: 100, h: 100 }),
    });
    assert.equal(a.status, 201);
    const b = await app.request(`/api/v1/floors/${otherFloor.id}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bathroom', x: 0, y: 0, w: 100, h: 100 }),
    });
    assert.equal(
      b.status,
      201,
      'same room name on a different floor is allowed (composite uniqueness)'
    );
  });

  it('G42(a): PATCH renaming a room to an existing name on same floor returns 409', async () => {
    const make = async (name: string): Promise<{ id: string }> => {
      const r = await app.request(`/api/v1/floors/${floorId}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, x: 0, y: 0, w: 100, h: 100 }),
      });
      return ((await r.json()) as { data: { id: string } }).data;
    };
    const a = await make('A');
    await make('B');
    const patch = await app.request(`/api/v1/rooms/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    assert.equal(patch.status, 409);
    const body = (await patch.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken/);
  });

  it('happy-path: create → list → get → patch → delete', async () => {
    const c = await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bedroom', x: 500, y: 500, w: 3000, h: 2500 }),
    });
    const created = ((await c.json()) as { data: Room }).data;
    const list = ((await (
      await app.request(`/api/v1/floors/${floorId}/rooms`)
    ).json()) as { data: Room[] }).data;
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, created.id);
    const g = await app.request(`/api/v1/rooms/${created.id}`);
    assert.equal(g.status, 200);
    const p = await app.request(`/api/v1/rooms/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Primary bedroom' }),
    });
    assert.equal(p.status, 200);
    const d = await app.request(`/api/v1/rooms/${created.id}`, { method: 'DELETE' });
    assert.equal(d.status, 204);
  });

  // Cycle-85 — flat GET /rooms returns rooms across all floors.
  it('cycle-85: GET /api/v1/rooms returns rooms across all floors', async () => {
    // Create a second floor + rooms on each.
    const f2 = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Upstairs' }),
    });
    const f2Id = ((await f2.json()) as { data: { id: string } }).data.id;

    await app.request(`/api/v1/floors/${floorId}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen', x: 0, y: 0, w: 1000, h: 1000 }),
    });
    await app.request(`/api/v1/floors/${f2Id}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bedroom', x: 0, y: 0, w: 1000, h: 1000 }),
    });

    const res = await app.request('/api/v1/rooms');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Room[] };
    assert.equal(body.data.length, 2);
    const names = body.data.map((r) => r.name).sort();
    assert.deepEqual(names, ['Bedroom', 'Kitchen']);
    // Rooms from different floors with cross-cutting floor_id.
    const floors = new Set(body.data.map((r) => r.floorId));
    assert.equal(floors.size, 2);
  });

  it('cycle-85: GET /api/v1/rooms returns empty array when no rooms exist', async () => {
    const res = await app.request('/api/v1/rooms');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Room[] };
    assert.deepEqual(body.data, []);
  });
});
