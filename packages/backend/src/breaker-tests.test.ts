/**
 * G36 cycle-61 — breaker-test audit-trail route + cascade tests.
 *
 * Covers POST/GET/DELETE happy paths, query filters (breakerId, since,
 * outcome), and the belt-and-suspenders cascade on breaker + panel delete.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Breaker, BreakerTest, Panel } from '@he/shared';
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

describe('breaker_tests (G36)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  let panel: Panel;
  let breaker: Breaker;

  const json = async <T,>(res: Response): Promise<T> =>
    (await res.json()) as T;

  const createPanel = async (name: string): Promise<Panel> => {
    const res = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.equal(res.status, 201);
    return (await json<{ data: Panel }>(res)).data;
  };

  const createBreaker = async (panelId: string, slot = '1'): Promise<Breaker> => {
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
      throw new Error(`create breaker failed: ${res.status} ${await res.text()}`);
    }
    return (await json<{ data: Breaker }>(res)).data;
  };

  const postTest = async (
    breakerId: string,
    body: Record<string, unknown> = {}
  ): Promise<Response> =>
    app.request(
      `/api/v1/breakers/${encodeURIComponent(breakerId)}/breaker-tests`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-bt-'));
    db = openDatabase(join(dir, 'bt.db'));
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
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST creates a test event with default testedAt', async () => {
    const before = Date.now();
    const res = await postTest(breaker.id);
    assert.equal(res.status, 201);
    const t = (await json<{ data: BreakerTest }>(res)).data;
    assert.equal(t.breakerId, breaker.id);
    assert.equal(t.outcome, null);
    assert.equal(t.notes, null);
    assert.ok(t.testedAt >= before);
    assert.ok(t.testedAt <= Date.now() + 50);
    assert.match(t.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('POST persists custom outcome + notes', async () => {
    const res = await postTest(breaker.id, {
      outcome: 'pass',
      notes: 'killed power, confirmed kitchen outlets dead',
    });
    assert.equal(res.status, 201);
    const t = (await json<{ data: BreakerTest }>(res)).data;
    assert.equal(t.outcome, 'pass');
    assert.equal(t.notes, 'killed power, confirmed kitchen outlets dead');
  });

  it('POST 404 when breaker does not exist', async () => {
    const res = await postTest('nope', { outcome: 'x' });
    assert.equal(res.status, 404);
  });

  it('GET filters by breakerId', async () => {
    const b2 = await createBreaker(panel.id, '3');
    await postTest(breaker.id, { outcome: 'a' });
    await postTest(b2.id, { outcome: 'b' });

    const res = await app.request(
      `/api/v1/breaker-tests?breakerId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal(res.status, 200);
    const tests = (await json<{ data: BreakerTest[]; totalCount: number }>(res)).data;
    assert.equal(tests.length, 1);
    assert.equal(tests[0]?.breakerId, breaker.id);
    assert.equal(tests[0]?.outcome, 'a');
  });

  it('GET filters by since (epoch ms inclusive)', async () => {
    // Two distinct test events at known timestamps.
    await postTest(breaker.id, { outcome: 'old', testedAt: 1000 });
    await postTest(breaker.id, { outcome: 'new', testedAt: 5000 });
    const res = await app.request('/api/v1/breaker-tests?since=2000');
    assert.equal(res.status, 200);
    const tests = (await json<{ data: BreakerTest[]; totalCount: number }>(res)).data;
    assert.equal(tests.length, 1);
    assert.equal(tests[0]?.outcome, 'new');
  });

  it('GET filters by outcome (free-text exact match)', async () => {
    await postTest(breaker.id, { outcome: 'pass' });
    await postTest(breaker.id, { outcome: 'fail' });
    await postTest(breaker.id, { outcome: 'pass' });

    const res = await app.request(
      '/api/v1/breaker-tests?outcome=pass'
    );
    const tests = (await json<{ data: BreakerTest[]; totalCount: number }>(res)).data;
    assert.equal(tests.length, 2);
    for (const t of tests) assert.equal(t.outcome, 'pass');
  });

  it('GET filters by until (epoch ms inclusive upper bound) [G36 Part 2]', async () => {
    await postTest(breaker.id, { outcome: 'before', testedAt: 1000 });
    await postTest(breaker.id, { outcome: 'edge', testedAt: 3000 });
    await postTest(breaker.id, { outcome: 'after', testedAt: 5000 });
    const res = await app.request('/api/v1/breaker-tests?until=3000');
    assert.equal(res.status, 200);
    const body = await json<{ data: BreakerTest[]; totalCount: number }>(res);
    assert.equal(body.data.length, 2);
    // "edge" (3000) and "before" (1000) — DESC order
    assert.deepEqual(
      body.data.map((t) => t.outcome),
      ['edge', 'before']
    );
    assert.equal(body.totalCount, 2);
  });

  it('GET combines since + until for a closed range [G36 Part 2]', async () => {
    await postTest(breaker.id, { outcome: 'a', testedAt: 1000 });
    await postTest(breaker.id, { outcome: 'b', testedAt: 3000 });
    await postTest(breaker.id, { outcome: 'c', testedAt: 5000 });
    await postTest(breaker.id, { outcome: 'd', testedAt: 7000 });
    const res = await app.request(
      '/api/v1/breaker-tests?since=3000&until=5000'
    );
    const body = await json<{ data: BreakerTest[]; totalCount: number }>(res);
    assert.equal(body.data.length, 2);
    assert.deepEqual(
      body.data.map((t) => t.outcome),
      ['c', 'b']
    );
  });

  it('GET caps LIMIT to 200 by default and exposes totalCount [G36 Part 2]', async () => {
    // Insert 5 rows then explicitly request limit=2 — assert totalCount
    // remains the unbounded count, while data is the limited slice.
    for (let i = 0; i < 5; i += 1) {
      await postTest(breaker.id, { outcome: `t${i}`, testedAt: 1000 + i });
    }
    const res = await app.request('/api/v1/breaker-tests?limit=2');
    const body = await json<{ data: BreakerTest[]; totalCount: number }>(res);
    assert.equal(body.data.length, 2);
    assert.equal(body.totalCount, 5);
    // Newest two first (testedAt DESC).
    assert.deepEqual(
      body.data.map((t) => t.outcome),
      ['t4', 't3']
    );
  });

  it('GET response shape always carries totalCount [G36 Part 2]', async () => {
    await postTest(breaker.id, { outcome: 'one' });
    await postTest(breaker.id, { outcome: 'two' });
    const res = await app.request('/api/v1/breaker-tests');
    const body = await json<{ data: BreakerTest[]; totalCount: number }>(res);
    assert.equal(typeof body.totalCount, 'number');
    assert.equal(body.totalCount, 2);
    assert.equal(body.data.length, 2);
  });

  it('GET sorts tested_at DESC, id DESC', async () => {
    await postTest(breaker.id, { outcome: '1', testedAt: 1000 });
    await postTest(breaker.id, { outcome: '2', testedAt: 3000 });
    await postTest(breaker.id, { outcome: '3', testedAt: 2000 });

    const res = await app.request('/api/v1/breaker-tests');
    const tests = (await json<{ data: BreakerTest[]; totalCount: number }>(res)).data;
    assert.deepEqual(
      tests.map((t) => t.outcome),
      ['2', '3', '1']
    );
  });

  it('DELETE removes the test', async () => {
    const post = await postTest(breaker.id, { outcome: 'x' });
    const t = (await json<{ data: BreakerTest }>(post)).data;

    const del = await app.request(
      `/api/v1/breaker-tests/${encodeURIComponent(t.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const list = await app.request('/api/v1/breaker-tests');
    const tests = (await json<{ data: BreakerTest[]; totalCount: number }>(list)).data;
    assert.equal(tests.length, 0);
  });

  it('DELETE 404 on miss', async () => {
    const res = await app.request('/api/v1/breaker-tests/nope', {
      method: 'DELETE',
    });
    assert.equal(res.status, 404);
  });

  it('cascade: deleting a breaker removes its tests', async () => {
    await postTest(breaker.id, { outcome: 'x' });
    await postTest(breaker.id, { outcome: 'y' });

    const before = await app.request(
      `/api/v1/breaker-tests?breakerId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal(
      (await json<{ data: BreakerTest[]; totalCount: number }>(before)).data.length,
      2
    );

    const del = await app.request(
      `/api/v1/breakers/${encodeURIComponent(breaker.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const after = await app.request(
      `/api/v1/breaker-tests?breakerId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal((await json<{ data: BreakerTest[]; totalCount: number }>(after)).data.length, 0);
  });

  it('cascade: deleting a panel removes its breakers\' tests', async () => {
    const b2 = await createBreaker(panel.id, '5');
    await postTest(breaker.id, { outcome: '1' });
    await postTest(b2.id, { outcome: '2' });

    // Sanity — both are there
    const before = await app.request('/api/v1/breaker-tests');
    assert.equal((await json<{ data: BreakerTest[] }>(before)).data.length, 2);

    const del = await app.request(
      `/api/v1/panels/${encodeURIComponent(panel.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);

    const after = await app.request('/api/v1/breaker-tests');
    assert.equal((await json<{ data: BreakerTest[]; totalCount: number }>(after)).data.length, 0);
  });

  it('latestByBreaker returns the most recent test per breaker', async () => {
    const repo = new SqliteBreakerTestRepository(db);
    const b2 = await createBreaker(panel.id, '7');
    const b3 = await createBreaker(panel.id, '9');

    await repo.create({ breakerId: breaker.id, testedAt: 100, outcome: 'old' });
    await repo.create({ breakerId: breaker.id, testedAt: 200, outcome: 'new' });
    await repo.create({ breakerId: b2.id, testedAt: 50, outcome: 'b2' });
    // b3 has none

    const map = await repo.latestByBreaker([breaker.id, b2.id, b3.id]);
    assert.equal(map.get(breaker.id)?.outcome, 'new');
    assert.equal(map.get(b2.id)?.outcome, 'b2');
    assert.equal(map.get(b3.id), null);
  });
});
