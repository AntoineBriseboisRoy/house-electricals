/**
 * G40 Part 1 cycle-66 — service_entries route + cascade tests.
 *
 * Covers POST (both breaker + component routes), GET filters (parentType,
 * parentId, parentIds, since, until, limit), DELETE, and the app-level
 * cascade in 3 sites (breaker delete, panel-bulk breaker delete, component
 * delete). Mirrors the cycle-61 breaker-tests.test.ts structure.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Breaker, Component, Panel, ServiceEntry } from '@he/shared';
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

describe('service_entries (G40 Part 1)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  let panel: Panel;
  let breaker: Breaker;
  let component: Component;

  const json = async <T,>(res: Response): Promise<T> =>
    (await res.json()) as T;

  type ListBody = { data: ServiceEntry[]; totalCount: number };

  const createPanel = async (name: string): Promise<Panel> => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.equal(res.status, 201);
    return (await json<{ data: Panel }>(res)).data;
  };

  const createBreaker = async (
    panelId: string,
    slot = '1'
  ): Promise<Breaker> => {
    const res = await app.request(
      `/api/v1/panels/${encodeURIComponent(panelId)}/breakers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slot,
          amperage: 20,
          poles: 'single',
          label: `Slot ${slot}`,
          slotPosition: Number.parseInt(slot, 10),
        }),
      }
    );
    if (res.status !== 201) {
      throw new Error(`create breaker failed: ${res.status}`);
    }
    return (await json<{ data: Breaker }>(res)).data;
  };

  const createComponent = async (name: string): Promise<Component> => {
    const res = await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'outlet', name }),
    });
    assert.equal(res.status, 201);
    return (await json<{ data: Component }>(res)).data;
  };

  const postBreakerEntry = async (
    breakerId: string,
    body: Record<string, unknown> = { note: 'serviced' }
  ): Promise<Response> =>
    app.request(
      `/api/v1/breakers/${encodeURIComponent(breakerId)}/service-entries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

  const postComponentEntry = async (
    componentId: string,
    body: Record<string, unknown> = { note: 'replaced bulb' }
  ): Promise<Response> =>
    app.request(
      `/api/v1/components/${encodeURIComponent(componentId)}/service-entries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-svc-'));
    db = openDatabase(join(dir, 'svc.db'));
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
      appUserRepository: null,
      auth: null,
    });
    panel = await createPanel('Main');
    breaker = await createBreaker(panel.id, '1');
    component = await createComponent('Kitchen outlet');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST /breakers/:id/service-entries creates with parent_type=breaker', async () => {
    const before = Date.now();
    const res = await postBreakerEntry(breaker.id, {
      note: 'tightened terminal',
    });
    assert.equal(res.status, 201);
    const e = (await json<{ data: ServiceEntry }>(res)).data;
    assert.equal(e.parentType, 'breaker');
    assert.equal(e.parentId, breaker.id);
    assert.equal(e.note, 'tightened terminal');
    assert.ok(e.occurredAt >= before);
    assert.ok(e.occurredAt <= Date.now() + 50);
    assert.match(e.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('POST /components/:id/service-entries creates with parent_type=component', async () => {
    const res = await postComponentEntry(component.id, {
      note: 'replaced GFCI receptacle',
    });
    assert.equal(res.status, 201);
    const e = (await json<{ data: ServiceEntry }>(res)).data;
    assert.equal(e.parentType, 'component');
    assert.equal(e.parentId, component.id);
    assert.equal(e.note, 'replaced GFCI receptacle');
  });

  it('POST persists custom occurredAt', async () => {
    const res = await postBreakerEntry(breaker.id, {
      note: 'past event',
      occurredAt: 12345678,
    });
    assert.equal(res.status, 201);
    const e = (await json<{ data: ServiceEntry }>(res)).data;
    assert.equal(e.occurredAt, 12345678);
  });

  it('POST without note → 400', async () => {
    const res = await postBreakerEntry(breaker.id, {});
    assert.equal(res.status, 400);
  });

  it('POST with empty note → 400', async () => {
    const res = await postBreakerEntry(breaker.id, { note: '' });
    assert.equal(res.status, 400);
  });

  it('POST 404 when breaker does not exist', async () => {
    const res = await postBreakerEntry('nope', { note: 'x' });
    assert.equal(res.status, 404);
  });

  it('POST 404 when component does not exist', async () => {
    const res = await postComponentEntry('nope', { note: 'x' });
    assert.equal(res.status, 404);
  });

  it('GET filters by parentType and parentId', async () => {
    await postBreakerEntry(breaker.id, { note: 'b-note' });
    await postComponentEntry(component.id, { note: 'c-note' });

    const r1 = await app.request(
      `/api/v1/service-entries?parentType=breaker&parentId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal(r1.status, 200);
    const b1 = await json<ListBody>(r1);
    assert.equal(b1.data.length, 1);
    assert.equal(b1.data[0]?.note, 'b-note');

    const r2 = await app.request(
      `/api/v1/service-entries?parentType=component&parentId=${encodeURIComponent(component.id)}`
    );
    const b2 = await json<ListBody>(r2);
    assert.equal(b2.data.length, 1);
    assert.equal(b2.data[0]?.note, 'c-note');
  });

  it('GET filters by parentIds (comma-separated bulk)', async () => {
    const b2 = await createBreaker(panel.id, '3');
    const b3 = await createBreaker(panel.id, '5');
    await postBreakerEntry(breaker.id, { note: 'a' });
    await postBreakerEntry(b2.id, { note: 'b' });
    await postBreakerEntry(b3.id, { note: 'c' });

    const res = await app.request(
      `/api/v1/service-entries?parentType=breaker&parentIds=${encodeURIComponent(breaker.id)},${encodeURIComponent(b2.id)}`
    );
    const body = await json<ListBody>(res);
    assert.equal(body.data.length, 2);
    assert.equal(body.totalCount, 2);
    const notes = new Set(body.data.map((e) => e.note));
    assert.ok(notes.has('a'));
    assert.ok(notes.has('b'));
    assert.ok(!notes.has('c'));
  });

  it('GET filters by since (epoch ms inclusive lower bound)', async () => {
    await postBreakerEntry(breaker.id, { note: 'old', occurredAt: 1000 });
    await postBreakerEntry(breaker.id, { note: 'new', occurredAt: 5000 });
    const res = await app.request(
      '/api/v1/service-entries?parentType=breaker&since=2000'
    );
    const body = await json<ListBody>(res);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.note, 'new');
  });

  it('GET filters by until (epoch ms inclusive upper bound)', async () => {
    await postBreakerEntry(breaker.id, { note: 'a', occurredAt: 1000 });
    await postBreakerEntry(breaker.id, { note: 'b', occurredAt: 3000 });
    await postBreakerEntry(breaker.id, { note: 'c', occurredAt: 5000 });
    const res = await app.request(
      '/api/v1/service-entries?parentType=breaker&until=3000'
    );
    const body = await json<ListBody>(res);
    assert.equal(body.data.length, 2);
    // DESC order: 'b' (3000) then 'a' (1000)
    assert.deepEqual(
      body.data.map((e) => e.note),
      ['b', 'a']
    );
  });

  it('GET respects LIMIT and returns totalCount before limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await postBreakerEntry(breaker.id, {
        note: `n${i}`,
        occurredAt: 1000 + i,
      });
    }
    const res = await app.request(
      '/api/v1/service-entries?parentType=breaker&limit=2'
    );
    const body = await json<ListBody>(res);
    assert.equal(body.data.length, 2);
    assert.equal(body.totalCount, 5);
    // Newest first (occurred_at DESC).
    assert.deepEqual(
      body.data.map((e) => e.note),
      ['n4', 'n3']
    );
  });

  it('GET sorts occurred_at DESC, id DESC', async () => {
    await postBreakerEntry(breaker.id, { note: '1', occurredAt: 1000 });
    await postBreakerEntry(breaker.id, { note: '2', occurredAt: 3000 });
    await postBreakerEntry(breaker.id, { note: '3', occurredAt: 2000 });
    const res = await app.request('/api/v1/service-entries');
    const body = await json<ListBody>(res);
    assert.deepEqual(
      body.data.map((e) => e.note),
      ['2', '3', '1']
    );
  });

  it('GET response always carries totalCount (cycle-63 shape)', async () => {
    await postBreakerEntry(breaker.id, { note: 'a' });
    await postBreakerEntry(breaker.id, { note: 'b' });
    const res = await app.request('/api/v1/service-entries');
    const body = await json<ListBody>(res);
    assert.equal(typeof body.totalCount, 'number');
    assert.equal(body.totalCount, 2);
    assert.equal(body.data.length, 2);
  });

  it('GET clamps an over-200 limit to 200 server-side', async () => {
    // Insert just 3 rows — we don't need 200; what we verify is that
    // requesting `?limit=999` doesn't throw (zod max is 1000), and the
    // server-side clamp doesn't break the response shape.
    await postBreakerEntry(breaker.id, { note: 'a' });
    await postBreakerEntry(breaker.id, { note: 'b' });
    await postBreakerEntry(breaker.id, { note: 'c' });
    const res = await app.request('/api/v1/service-entries?limit=999');
    assert.equal(res.status, 200);
    const body = await json<ListBody>(res);
    assert.equal(body.data.length, 3);
    assert.equal(body.totalCount, 3);
  });

  it('DELETE removes the entry', async () => {
    const post = await postBreakerEntry(breaker.id, { note: 'x' });
    const e = (await json<{ data: ServiceEntry }>(post)).data;
    const del = await app.request(
      `/api/v1/service-entries/${encodeURIComponent(e.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);
    const list = await app.request('/api/v1/service-entries');
    const body = await json<ListBody>(list);
    assert.equal(body.data.length, 0);
  });

  it('DELETE 404 on miss', async () => {
    const res = await app.request('/api/v1/service-entries/nope', {
      method: 'DELETE',
    });
    assert.equal(res.status, 404);
  });

  it('cascade: deleting a breaker removes its service entries', async () => {
    await postBreakerEntry(breaker.id, { note: 'x' });
    await postBreakerEntry(breaker.id, { note: 'y' });

    const before = await app.request(
      `/api/v1/service-entries?parentType=breaker&parentId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal((await json<ListBody>(before)).data.length, 2);

    const del = await app.request(
      `/api/v1/breakers/${encodeURIComponent(breaker.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const after = await app.request(
      `/api/v1/service-entries?parentType=breaker&parentId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal((await json<ListBody>(after)).data.length, 0);
  });

  it("cascade: deleting a panel removes its breakers' service entries", async () => {
    const b2 = await createBreaker(panel.id, '5');
    await postBreakerEntry(breaker.id, { note: '1' });
    await postBreakerEntry(b2.id, { note: '2' });

    const before = await app.request(
      '/api/v1/service-entries?parentType=breaker'
    );
    assert.equal((await json<ListBody>(before)).data.length, 2);

    const del = await app.request(
      `/api/v1/panels/${encodeURIComponent(panel.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const after = await app.request(
      '/api/v1/service-entries?parentType=breaker'
    );
    assert.equal((await json<ListBody>(after)).data.length, 0);
  });

  it('cascade: deleting a component removes its service entries', async () => {
    await postComponentEntry(component.id, { note: 'a' });
    await postComponentEntry(component.id, { note: 'b' });

    const before = await app.request(
      `/api/v1/service-entries?parentType=component&parentId=${encodeURIComponent(component.id)}`
    );
    assert.equal((await json<ListBody>(before)).data.length, 2);

    const del = await app.request(
      `/api/v1/components/${encodeURIComponent(component.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const after = await app.request(
      `/api/v1/service-entries?parentType=component&parentId=${encodeURIComponent(component.id)}`
    );
    assert.equal((await json<ListBody>(after)).data.length, 0);
  });

  it('cascade isolation: deleting a breaker does NOT touch component entries', async () => {
    await postBreakerEntry(breaker.id, { note: 'b' });
    await postComponentEntry(component.id, { note: 'c' });

    const del = await app.request(
      `/api/v1/breakers/${encodeURIComponent(breaker.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const compEntries = await app.request(
      `/api/v1/service-entries?parentType=component&parentId=${encodeURIComponent(component.id)}`
    );
    assert.equal((await json<ListBody>(compEntries)).data.length, 1);
  });
});
