/**
 * 2026-05 — breaker on/off state + audit (breaker_state_events) tests.
 *
 * Covers: default isOn=true on create; POST /state persists is_on and writes
 * an audit event scoped to breaker + panel; GET filters by breaker/panel;
 * the audit list caps + reports totalCount; and the FK cascade drops events
 * when the breaker (or its panel) is deleted.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Breaker, BreakerStateEvent, Panel } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

describe('breaker on/off state (2026-05)', () => {
  let cleanup: () => Promise<void>;
  let db: Db;
  let app: Hono;
  let panel: Panel;
  let breaker: Breaker;

  const json = async <T,>(res: Response): Promise<T> => (await res.json()) as T;

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

  const setState = async (
    breakerId: string,
    body: Record<string, unknown>
  ): Promise<Response> =>
    app.request(`/api/v1/breakers/${encodeURIComponent(breakerId)}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const listEvents = async (
    query = ''
  ): Promise<{ data: BreakerStateEvent[]; totalCount: number }> => {
    const res = await app.request(`/api/v1/breaker-state-events${query}`);
    assert.equal(res.status, 200);
    return json<{ data: BreakerStateEvent[]; totalCount: number }>(res);
  };

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
    panel = await createPanel('Main');
    breaker = await createBreaker(panel.id, '1');
  });

  afterEach(async () => {
    await cleanup();
  });

  it('new breakers default to ON (isOn=true)', () => {
    assert.equal(breaker.isOn, true);
  });

  it('POST /state turns a breaker off and persists across reads', async () => {
    const res = await setState(breaker.id, { isOn: false });
    assert.equal(res.status, 200);
    const updated = (await json<{ data: Breaker }>(res)).data;
    assert.equal(updated.isOn, false);

    // Re-fetch the breaker via the panel listing — state is durable.
    const listRes = await app.request(
      `/api/v1/panels/${encodeURIComponent(panel.id)}/breakers`
    );
    const breakers = (await json<{ data: Breaker[] }>(listRes)).data;
    assert.equal(breakers.find((b) => b.id === breaker.id)?.isOn, false);
  });

  it('POST /state writes an audit event scoped to breaker AND panel', async () => {
    const before = Date.now();
    await setState(breaker.id, { isOn: false, note: 'tripped while testing' });

    const { data, totalCount } = await listEvents(
      `?breakerId=${encodeURIComponent(breaker.id)}`
    );
    assert.equal(totalCount, 1);
    assert.equal(data.length, 1);
    const ev = data[0]!;
    assert.equal(ev.breakerId, breaker.id);
    assert.equal(ev.panelId, panel.id);
    assert.equal(ev.isOn, false);
    assert.equal(ev.note, 'tripped while testing');
    assert.ok(ev.occurredAt >= before);
    assert.match(ev.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('records on AND off toggles in order (newest first)', async () => {
    await setState(breaker.id, { isOn: false });
    await setState(breaker.id, { isOn: true });
    const { data, totalCount } = await listEvents();
    assert.equal(totalCount, 2);
    assert.equal(data[0]!.isOn, true); // newest first
    assert.equal(data[1]!.isOn, false);
  });

  it('GET filters by panelId', async () => {
    const otherPanel = await createPanel('Other');
    const otherBreaker = await createBreaker(otherPanel.id, '1');
    await setState(breaker.id, { isOn: false });
    await setState(otherBreaker.id, { isOn: false });

    const mine = await listEvents(`?panelId=${encodeURIComponent(panel.id)}`);
    assert.equal(mine.totalCount, 1);
    assert.equal(mine.data[0]!.breakerId, breaker.id);

    const theirs = await listEvents(
      `?panelId=${encodeURIComponent(otherPanel.id)}`
    );
    assert.equal(theirs.totalCount, 1);
    assert.equal(theirs.data[0]!.breakerId, otherBreaker.id);
  });

  it('POST /state on a missing breaker is 404', async () => {
    const res = await setState('does-not-exist', { isOn: false });
    assert.equal(res.status, 404);
  });

  it('POST /state rejects a non-boolean isOn (400)', async () => {
    const res = await setState(breaker.id, { isOn: 'off' });
    assert.equal(res.status, 400);
  });

  it('deleting the breaker cascades its state events', async () => {
    await setState(breaker.id, { isOn: false });
    assert.equal((await listEvents()).totalCount, 1);

    const del = await app.request(
      `/api/v1/breakers/${encodeURIComponent(breaker.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);
    assert.equal((await listEvents()).totalCount, 0);
  });

  it('deleting the panel cascades its breakers state events', async () => {
    await setState(breaker.id, { isOn: false });
    assert.equal((await listEvents()).totalCount, 1);

    const del = await app.request(
      `/api/v1/panels/${encodeURIComponent(panel.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);
    assert.equal((await listEvents()).totalCount, 0);
  });
});
