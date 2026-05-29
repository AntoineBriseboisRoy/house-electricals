import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Floor, Wall } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

describe('wall routes (G12)', () => {
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
      body: JSON.stringify({ name: 'Basement' }),
    });
    floorId = ((await r.json()) as { data: { id: string } }).data.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('GET /api/v1/floors/:floorId/walls returns empty initially', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/walls`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Wall[] };
    assert.deepEqual(body.data, []);
  });

  it('GET on missing floor returns 404', async () => {
    const res = await app.request('/api/v1/floors/nope/walls');
    assert.equal(res.status, 404);
  });

  it('POST creates a wall with int coords', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0, y1: 0, x2: 5000, y2: 5000 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Wall };
    assert.equal(body.data.floorId, floorId);
    assert.deepEqual(
      { x1: body.data.x1, y1: body.data.y1, x2: body.data.x2, y2: body.data.y2 },
      { x1: 0, y1: 0, x2: 5000, y2: 5000 }
    );
  });

  it('POST rejects out-of-range coords (zod 400)', async () => {
    // Beyond the widened COORD_MIN..COORD_MAX bounds (±100000). The legacy
    // 0..10000 window no longer bounds geometry — the plan is unbounded.
    const res = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0, y1: 0, x2: 100001, y2: 0 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST accepts coords beyond the legacy 0–10000 window', async () => {
    // Regression for the unbounded-canvas widening: negative + far-out
    // coordinates are now valid (they live off the initial viewBox window
    // and are reached by panning).
    const res = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: -5000, y1: 0, x2: 50000, y2: 25000 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      data: { x1: number; x2: number; y2: number };
    };
    assert.equal(body.data.x1, -5000);
    assert.equal(body.data.x2, 50000);
    assert.equal(body.data.y2, 25000);
  });

  it('POST rejects non-integer coords', async () => {
    const res = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0.5, y1: 0, x2: 100, y2: 100 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST on missing floor returns 404', async () => {
    const res = await app.request('/api/v1/floors/nope/walls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    });
    assert.equal(res.status, 404);
  });

  it('PATCH partial coords updates only the supplied fields', async () => {
    const r = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 100, y1: 200, x2: 300, y2: 400 }),
    });
    const wall = ((await r.json()) as { data: Wall }).data;
    const p = await app.request(`/api/v1/walls/${wall.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x2: 9999, y2: 9999 }),
    });
    assert.equal(p.status, 200);
    const updated = ((await p.json()) as { data: Wall }).data;
    assert.equal(updated.x1, 100);
    assert.equal(updated.y1, 200);
    assert.equal(updated.x2, 9999);
    assert.equal(updated.y2, 9999);
    assert.equal(updated.floorId, floorId, 'floor_id never changes via PATCH');
  });

  it('DELETE removes a wall (204)', async () => {
    const r = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    });
    const wall = ((await r.json()) as { data: Wall }).data;
    const d = await app.request(`/api/v1/walls/${wall.id}`, { method: 'DELETE' });
    assert.equal(d.status, 204);
    const after = await app.request(`/api/v1/walls/${wall.id}`);
    assert.equal(after.status, 404);
  });

  it('DELETE on a floor cascades to delete its walls', async () => {
    const fres = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Disposable' }),
    });
    const floor = ((await fres.json()) as { data: Floor }).data;

    await app.request(`/api/v1/floors/${floor.id}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    });
    await app.request(`/api/v1/floors/${floor.id}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 200, y1: 200, x2: 300, y2: 300 }),
    });

    const list1 = ((await (
      await app.request(`/api/v1/floors/${floor.id}/walls`)
    ).json()) as { data: Wall[] }).data;
    assert.equal(list1.length, 2);

    const del = await app.request(`/api/v1/floors/${floor.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    // Floor is gone, AND its walls are gone (ON DELETE CASCADE).
    const row = await db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM walls WHERE floor_id = $1',
      [floor.id]
    );
    assert.equal(Number(row?.n), 0);
  });

  it('happy-path: create → list-by-floor → get → patch → delete', async () => {
    const c = await app.request(`/api/v1/floors/${floorId}/walls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 1000, y1: 1000, x2: 9000, y2: 9000 }),
    });
    const created = ((await c.json()) as { data: Wall }).data;

    const list = ((await (
      await app.request(`/api/v1/floors/${floorId}/walls`)
    ).json()) as { data: Wall[] }).data;
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, created.id);

    const g = await app.request(`/api/v1/walls/${created.id}`);
    assert.equal(g.status, 200);

    const p = await app.request(`/api/v1/walls/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x1: 500 }),
    });
    assert.equal(p.status, 200);

    const d = await app.request(`/api/v1/walls/${created.id}`, { method: 'DELETE' });
    assert.equal(d.status, 204);
  });
});
