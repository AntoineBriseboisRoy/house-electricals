import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import { buildTestApp, createTestDb } from './test-helpers.js';

describe('panel routes', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('GET /api/v1/health returns ok envelope', async () => {
    const res = await app.request('/api/v1/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { ok: true } });
  });

  it('GET /api/v1/panels returns empty data array initially', async () => {
    const res = await app.request('/api/v1/panels');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: [] });
  });

  it('POST /api/v1/panels creates a panel and returns envelope with 201', async () => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main panel' }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { id: string; name: string; createdAt: number } };
    assert.equal(body.data.name, 'Main panel');
    assert.match(body.data.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('POST /api/v1/panels rejects empty name with 400', async () => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/v1/panels rejects missing name with 400', async () => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/v1/panels rejects non-JSON with 400', async () => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    assert.equal(res.status, 400);
  });

  it('round-trips: POST then GET shows the created panel', async () => {
    await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Garage sub-panel' }),
    });
    const list = await app.request('/api/v1/panels');
    const body = (await list.json()) as { data: { name: string }[] };
    assert.deepEqual(
      body.data.map((p) => p.name),
      ['Garage sub-panel']
    );
  });

  it('GET /api/v1/panels/:id returns the panel or 404', async () => {
    const created = (await (
      await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'P' }),
      })
    ).json()) as { data: { id: string } };

    const found = await app.request(`/api/v1/panels/${created.data.id}`);
    assert.equal(found.status, 200);
    assert.equal(((await found.json()) as { data: { id: string } }).data.id, created.data.id);

    const missing = await app.request('/api/v1/panels/nonexistent');
    assert.equal(missing.status, 404);
  });

  it('DELETE /api/v1/panels/:id returns 204 and cascades to breakers', async () => {
    const created = (await (
      await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
    ).json()) as { data: { id: string } };
    const panelId = created.data.id;

    await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'a' }),
    });
    await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '2', amperage: 20, poles: 'single', label: 'b' }),
    });

    const del = await app.request(`/api/v1/panels/${panelId}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const listAfter = await app.request(`/api/v1/panels/${panelId}/breakers`);
    assert.equal(listAfter.status, 404);

    const missingDelete = await app.request('/api/v1/panels/nonexistent', { method: 'DELETE' });
    assert.equal(missingDelete.status, 404);
  });

  // === G42(a) cycle-49 — UNIQUE panels(name) =================================

  it('G42(a): POST duplicate panel name returns 409 with "is already taken"', async () => {
    const r1 = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main' }),
    });
    assert.equal(r1.status, 201);
    const r2 = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main' }),
    });
    assert.equal(r2.status, 409);
    const body = (await r2.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken/);
    assert.match(body.error.message, /Main/);
  });

  it('G42(a): PATCH renaming a panel to an existing name returns 409', async () => {
    const mk = async (name: string): Promise<{ id: string }> => {
      const r = await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return ((await r.json()) as { data: { id: string } }).data;
    };
    const a = await mk('A');
    await mk('B');
    const patch = await app.request(`/api/v1/panels/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    assert.equal(patch.status, 409);
  });

  it('G42(a): PATCH that does not change name does not conflict', async () => {
    const mk = async (name: string): Promise<{ id: string }> => {
      const r = await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return ((await r.json()) as { data: { id: string } }).data;
    };
    const a = await mk('SlotChange');
    // PATCH only slotCount — name stays "SlotChange", no UNIQUE conflict.
    const patch = await app.request(`/api/v1/panels/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotCount: 30 }),
    });
    assert.equal(patch.status, 200);
  });
});

describe('breaker routes', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;
  let panelId: string;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    app = buildTestApp(t.db);
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const body = (await res.json()) as { data: { id: string } };
    panelId = body.data.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('GET /api/v1/panels/:id/breakers returns empty array initially', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: [] });
  });

  it('GET /api/v1/panels/:id/breakers returns 404 for unknown panel', async () => {
    const res = await app.request('/api/v1/panels/nonexistent/breakers');
    assert.equal(res.status, 404);
  });

  it('POST /api/v1/panels/:id/breakers creates a breaker (201)', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'Kitchen' }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { slot: string; amperage: number; poles: string } };
    assert.equal(body.data.slot, '1');
    assert.equal(body.data.amperage, 20);
    assert.equal(body.data.poles, 'single');
  });

  it('POST rejects invalid poles enum with 400', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'triple', label: 'Bad' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects missing field with 400', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects negative amperage with 400', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: -1, poles: 'single', label: 'Bad' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST against unknown panel returns 404', async () => {
    const res = await app.request('/api/v1/panels/nonexistent/breakers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'Kitchen' }),
    });
    assert.equal(res.status, 404);
  });

  it('GET /api/v1/breakers/:id returns the breaker or 404', async () => {
    const post = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '5', amperage: 30, poles: 'double', label: 'Dryer' }),
    });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const ok = await app.request(`/api/v1/breakers/${created.id}`);
    assert.equal(ok.status, 200);

    const missing = await app.request('/api/v1/breakers/nonexistent');
    assert.equal(missing.status, 404);
  });

  it('PATCH /api/v1/breakers/:id updates partial fields, 400 on bad enum, 404 on missing', async () => {
    const post = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'a' }),
    });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const patched = await app.request(`/api/v1/breakers/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amperage: 30, label: 'updated' }),
    });
    assert.equal(patched.status, 200);
    const body = (await patched.json()) as { data: { amperage: number; label: string } };
    assert.equal(body.data.amperage, 30);
    assert.equal(body.data.label, 'updated');

    const badEnum = await app.request(`/api/v1/breakers/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ poles: 'quad' }),
    });
    assert.equal(badEnum.status, 400);

    const miss = await app.request('/api/v1/breakers/nonexistent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amperage: 10 }),
    });
    assert.equal(miss.status, 404);
  });

  it('DELETE /api/v1/breakers/:id returns 204 or 404', async () => {
    const post = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'a' }),
    });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const ok = await app.request(`/api/v1/breakers/${created.id}`, { method: 'DELETE' });
    assert.equal(ok.status, 204);
    const after = await app.request(`/api/v1/breakers/${created.id}`);
    assert.equal(after.status, 404);

    const miss = await app.request('/api/v1/breakers/nonexistent', { method: 'DELETE' });
    assert.equal(miss.status, 404);
  });

  it('lists are sorted by slot_position ASC NULLS LAST then slot ASC', async () => {
    const post = async (body: object) =>
      app.request(`/api/v1/panels/${panelId}/breakers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    // G33 cycle-41: slot must be a whole number in [1..panel.slotCount];
    // server auto-syncs slotPosition to the slot integer when not specified.
    // Posting in reverse slot order (7, 5, 3) — list should come back
    // sorted by slotPosition ASC: 3 ("c"), 5 ("b"), 7 ("a").
    await post({ slot: '7', amperage: 20, poles: 'single', label: 'a' });
    await post({ slot: '5', amperage: 20, poles: 'single', label: 'b' });
    await post({ slot: '3', amperage: 20, poles: 'single', label: 'c' });

    const list = await app.request(`/api/v1/panels/${panelId}/breakers`);
    const body = (await list.json()) as { data: { slot: string; label: string }[] };
    assert.deepEqual(
      body.data.map((b) => b.label),
      ['c', 'b', 'a']
    );
  });

  it('rejects non-integer slot with 400', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: 'A12',
        amperage: 20,
        poles: 'single',
        label: 'bad',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /whole number/i);
  });

  it('rejects slot out of panel range with 400', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '999',
        amperage: 20,
        poles: 'single',
        label: 'too high',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /slots? — pick/i);
  });

  it('rejects slot collision with 400', async () => {
    // First breaker on slot 1 — succeeds.
    const first = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 20,
        poles: 'single',
        label: 'first',
      }),
    });
    assert.equal(first.status, 201);

    // Second on slot 1 — collides → 400.
    const dup = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 20,
        poles: 'single',
        label: 'dup',
      }),
    });
    assert.equal(dup.status, 400);
    const body = (await dup.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken/i);
  });

  it('rejects double-pole whose adjacent slot is occupied', async () => {
    // Slot 2 is single-pole.
    await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '2',
        amperage: 20,
        poles: 'single',
        label: 'block',
      }),
    });
    // Double-pole on slot 1 wants slot 2 too — should be rejected.
    const conflict = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 30,
        poles: 'double',
        label: 'range',
      }),
    });
    assert.equal(conflict.status, 400);
    const body = (await conflict.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken|past the panel/i);
  });

  // G34 cycle-42 — tandem-as-two-circuits validation tests.
  it('accepts two tandem halves on the same slot (a + b)', async () => {
    const post = (body: object) =>
      app.request(`/api/v1/panels/${panelId}/breakers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const a = await post({
      slot: '5',
      amperage: 15,
      poles: 'tandem',
      label: 'kitchen-a',
      tandemHalf: 'a',
    });
    assert.equal(a.status, 201);
    const b = await post({
      slot: '5',
      amperage: 15,
      poles: 'tandem',
      label: 'kitchen-b',
      tandemHalf: 'b',
    });
    assert.equal(b.status, 201);
    const bBody = (await b.json()) as { data: { tandemHalf: string } };
    assert.equal(bBody.data.tandemHalf, 'b');
  });

  it('rejects two tandem-a on the same slot', async () => {
    const post = (body: object) =>
      app.request(`/api/v1/panels/${panelId}/breakers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post({
      slot: '6',
      amperage: 15,
      poles: 'tandem',
      label: 'first',
      tandemHalf: 'a',
    });
    const dup = await post({
      slot: '6',
      amperage: 15,
      poles: 'tandem',
      label: 'dup',
      tandemHalf: 'a',
    });
    assert.equal(dup.status, 400);
    const body = (await dup.json()) as { error: { message: string } };
    assert.match(body.error.message, /already taken/i);
  });

  it('rejects tandem on a slot already taken by single-pole', async () => {
    const post = (body: object) =>
      app.request(`/api/v1/panels/${panelId}/breakers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post({
      slot: '7',
      amperage: 20,
      poles: 'single',
      label: 'single',
    });
    const conflict = await post({
      slot: '7',
      amperage: 15,
      poles: 'tandem',
      label: 'tandem',
      tandemHalf: 'a',
    });
    assert.equal(conflict.status, 400);
    const body = (await conflict.json()) as { error: { message: string } };
    assert.match(body.error.message, /non-tandem|can't share/i);
  });

  it('rejects tandem without a tandemHalf', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '8',
        amperage: 15,
        poles: 'tandem',
        label: 'incomplete',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /pick a half/i);
  });

  it('rejects non-tandem with a tandemHalf set', async () => {
    const res = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '9',
        amperage: 20,
        poles: 'single',
        label: 'wrong',
        tandemHalf: 'a',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /Only tandem/i);
  });
});

describe('component routes', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    await cleanup();
  });

  const postComponent = async (body: object) =>
    app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/v1/components returns empty data initially', async () => {
    const res = await app.request('/api/v1/components');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: [] });
  });

  it('POST creates a component (201) with default null room/notes/breakerId', async () => {
    const res = await postComponent({ type: 'outlet', name: 'Counter outlet' });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { type: string; room: null; breakerId: null } };
    assert.equal(body.data.type, 'outlet');
    assert.equal(body.data.room, null);
    assert.equal(body.data.breakerId, null);
  });

  it('POST rejects invalid type enum with 400', async () => {
    const res = await postComponent({ type: 'fridge', name: 'X' });
    assert.equal(res.status, 400);
  });

  it('POST rejects missing name with 400', async () => {
    const res = await postComponent({ type: 'outlet' });
    assert.equal(res.status, 400);
  });

  it('GET /api/v1/components/:id returns 200 or 404', async () => {
    const post = await postComponent({ type: 'light', name: 'L', room: 'Hallway' });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const ok = await app.request(`/api/v1/components/${created.id}`);
    assert.equal(ok.status, 200);

    const miss = await app.request('/api/v1/components/nonexistent');
    assert.equal(miss.status, 404);
  });

  it('PATCH updates partial, 400 on bad enum, 404 on missing', async () => {
    const post = await postComponent({ type: 'outlet', name: 'a' });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const ok = await app.request(`/api/v1/components/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'b', room: 'Kitchen' }),
    });
    assert.equal(ok.status, 200);

    const bad = await app.request(`/api/v1/components/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'fridge' }),
    });
    assert.equal(bad.status, 400);

    const miss = await app.request('/api/v1/components/nonexistent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(miss.status, 404);
  });

  it('DELETE returns 204 or 404', async () => {
    const post = await postComponent({ type: 'switch', name: 'S' });
    const created = ((await post.json()) as { data: { id: string } }).data;

    const ok = await app.request(`/api/v1/components/${created.id}`, { method: 'DELETE' });
    assert.equal(ok.status, 204);

    const miss = await app.request('/api/v1/components/nonexistent', { method: 'DELETE' });
    assert.equal(miss.status, 404);
  });

  it('GET with ?room= filters exactly and case-sensitively', async () => {
    await postComponent({ type: 'outlet', name: 'a', room: 'Kitchen' });
    await postComponent({ type: 'outlet', name: 'b', room: 'kitchen' });

    const upper = await app.request('/api/v1/components?room=Kitchen');
    const upperBody = (await upper.json()) as { data: { name: string }[] };
    assert.deepEqual(
      upperBody.data.map((c) => c.name),
      ['a']
    );

    const lower = await app.request('/api/v1/components?room=kitchen');
    const lowerBody = (await lower.json()) as { data: { name: string }[] };
    assert.deepEqual(
      lowerBody.data.map((c) => c.name),
      ['b']
    );
  });

  it('GET with ?type=invalid returns 400', async () => {
    const res = await app.request('/api/v1/components?type=fridge');
    assert.equal(res.status, 400);
  });

  it('GET with ?type=light returns only lights', async () => {
    await postComponent({ type: 'outlet', name: 'a' });
    await postComponent({ type: 'light', name: 'b' });
    await postComponent({ type: 'light', name: 'c' });

    const res = await app.request('/api/v1/components?type=light');
    const body = (await res.json()) as { data: { name: string }[] };
    assert.deepEqual(
      body.data.map((c) => c.name),
      ['b', 'c']
    );
  });

  it('POST with breakerId pointing at a valid breaker returns 201 and persists it', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'L' }),
    });
    const breakerId = ((await breakerRes.json()) as { data: { id: string } }).data.id;

    const res = await postComponent({ type: 'outlet', name: 'X', breakerId });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { breakerId: string } };
    assert.equal(body.data.breakerId, breakerId);
  });

  it('POST with bogus breakerId returns 400 Breaker not found', async () => {
    const res = await postComponent({ type: 'outlet', name: 'X', breakerId: 'nope' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /Breaker not found/);
  });

  it('PATCH can unassign (breakerId: null) and reassign to a valid breaker', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'L' }),
    });
    const breakerId = ((await breakerRes.json()) as { data: { id: string } }).data.id;

    const created = await postComponent({ type: 'outlet', name: 'X', breakerId });
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const unassigned = await app.request(`/api/v1/components/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakerId: null }),
    });
    const u = (await unassigned.json()) as { data: { breakerId: string | null } };
    assert.equal(u.data.breakerId, null);

    const reassigned = await app.request(`/api/v1/components/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakerId }),
    });
    const r = (await reassigned.json()) as { data: { breakerId: string } };
    assert.equal(r.data.breakerId, breakerId);
  });

  it('PATCH to a bogus breakerId returns 400', async () => {
    const created = await postComponent({ type: 'outlet', name: 'X' });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const res = await app.request(`/api/v1/components/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakerId: 'nope' }),
    });
    assert.equal(res.status, 400);
  });

  it('GET ?breakerId=<id> filters list to that breaker\'s components', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;

    const post = async (label: string): Promise<string> => {
      const r = await app.request(`/api/v1/panels/${panelId}/breakers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: label, amperage: 20, poles: 'single', label }),
      });
      return ((await r.json()) as { data: { id: string } }).data.id;
    };
    const b1 = await post('1');
    const b2 = await post('2');

    await postComponent({ type: 'outlet', name: 'on-b1', breakerId: b1 });
    await postComponent({ type: 'outlet', name: 'on-b2', breakerId: b2 });
    await postComponent({ type: 'outlet', name: 'unassigned' });

    const filtered = await app.request(`/api/v1/components?breakerId=${b1}`);
    const body = (await filtered.json()) as { data: { name: string }[] };
    assert.deepEqual(
      body.data.map((c) => c.name),
      ['on-b1']
    );
  });

  it('DELETE breaker leaves component alive with breakerId=null', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'L' }),
    });
    const breakerId = ((await breakerRes.json()) as { data: { id: string } }).data.id;

    const created = await postComponent({ type: 'outlet', name: 'X', breakerId });
    const componentId = ((await created.json()) as { data: { id: string } }).data.id;

    const delRes = await app.request(`/api/v1/breakers/${breakerId}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);

    const after = await app.request(`/api/v1/components/${componentId}`);
    const body = (await after.json()) as { data: { breakerId: string | null } };
    assert.equal(body.data.breakerId, null);
  });

  it('happy-path: create→list→get→patch→delete cycle', async () => {
    const created = ((await (
      await postComponent({ type: 'outlet', name: 'Foo', room: 'Bar', notes: 'n' })
    ).json()) as { data: { id: string } }).data;

    const list = await app.request('/api/v1/components');
    assert.equal(((await list.json()) as { data: unknown[] }).data.length, 1);

    const got = await app.request(`/api/v1/components/${created.id}`);
    assert.equal(got.status, 200);

    const patched = await app.request(`/api/v1/components/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NewFoo' }),
    });
    const patchedBody = (await patched.json()) as { data: { name: string } };
    assert.equal(patchedBody.data.name, 'NewFoo');

    const del = await app.request(`/api/v1/components/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const after = await app.request(`/api/v1/components/${created.id}`);
    assert.equal(after.status, 404);
  });

  it('G37 cycle-68 — POST component with protection=gfci persists', async () => {
    const res = await postComponent({
      type: 'outlet',
      name: 'GFCI receptacle',
      protection: 'gfci',
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { protection: string | null } };
    assert.equal(body.data.protection, 'gfci');
  });

  it('G37 cycle-68 — POST component with protection=null persists as null', async () => {
    const res = await postComponent({
      type: 'outlet',
      name: 'Plain',
      protection: null,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { protection: string | null } };
    assert.equal(body.data.protection, null);
  });

  it('G37 cycle-68 — POST component with invalid protection rejected (400)', async () => {
    const res = await postComponent({
      type: 'outlet',
      name: 'Bogus',
      protection: 'invalid',
    });
    assert.equal(res.status, 400);
  });

  it('G37 cycle-68 — PATCH updates protection', async () => {
    const created = await postComponent({ type: 'outlet', name: 'X' });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const patched = await app.request(`/api/v1/components/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protection: 'afci' }),
    });
    assert.equal(patched.status, 200);
    const body = (await patched.json()) as { data: { protection: string | null } };
    assert.equal(body.data.protection, 'afci');

    // Clearing back to null.
    const cleared = await app.request(`/api/v1/components/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protection: null }),
    });
    const clearedBody = (await cleared.json()) as { data: { protection: string | null } };
    assert.equal(clearedBody.data.protection, null);
  });

  it('G37 cycle-68 — POST breaker with protection=gfci persists', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 20,
        poles: 'single',
        label: 'GFCI bath',
        protection: 'gfci',
      }),
    });
    assert.equal(breakerRes.status, 201);
    const body = (await breakerRes.json()) as { data: { protection: string | null } };
    assert.equal(body.data.protection, 'gfci');
  });

  it('G37 cycle-68 — POST breaker with invalid protection rejected (400)', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 20,
        poles: 'single',
        label: 'X',
        protection: 'bogus',
      }),
    });
    assert.equal(breakerRes.status, 400);
  });

  it('G37 cycle-68 — PATCH breaker updates protection', async () => {
    const panelRes = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const panelId = ((await panelRes.json()) as { data: { id: string } }).data.id;
    const breakerRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        amperage: 20,
        poles: 'single',
        label: 'X',
      }),
    });
    const breakerId = ((await breakerRes.json()) as { data: { id: string } }).data.id;

    const patched = await app.request(`/api/v1/breakers/${breakerId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protection: 'dual' }),
    });
    assert.equal(patched.status, 200);
    const body = (await patched.json()) as { data: { protection: string | null } };
    assert.equal(body.data.protection, 'dual');
  });
});

describe('security headers', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('sets baseline hardening headers on an API response', async () => {
    const res = await app.request('/api/v1/health');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(
      res.headers.get('cross-origin-resource-policy'),
      'same-origin'
    );
    // Strips the framework fingerprint.
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('emits a conservative same-origin Content-Security-Policy (G46 FIX 3)', async () => {
    const res = await app.request('/api/v1/health');
    const csp = res.headers.get('content-security-policy');
    // G46 FIX 3 — a CSP tuned to the Vite/PWA bundle is now emitted on every
    // response (see server.ts). Lock in that it is present + same-origin.
    assert.ok(csp, 'expected a content-security-policy header');
    assert.ok(csp.includes("default-src 'self'"), `got: ${csp}`);
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });
});

describe('config route (TZ)', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;
  const originalTz = process.env.TZ;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    await cleanup();
  });

  it('reports the configured TZ', async () => {
    process.env.TZ = 'America/Toronto';
    const res = await app.request('/api/v1/config');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { tz: 'America/Toronto' } });
  });

  it('reports tz: null when TZ is empty/unset', async () => {
    process.env.TZ = '';
    const res = await app.request('/api/v1/config');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { tz: null } });
  });
});
