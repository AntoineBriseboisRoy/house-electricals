import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Building, WarningDismissal } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

/**
 * Warning-dismissals route tests (2026-05).
 *
 * Covers the persistence behind the dismissible monthly GFCI/AFCI banner:
 * per-building, per-kind, per-period dismissals that auto-expire when the
 * period key (month-start epoch) changes.
 */
describe('warning-dismissals routes', () => {
  let cleanup: () => Promise<void>;
  let db: Db;
  let app: Hono;
  let buildingId: string;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
    // initSchema seeds a single default "My House" building.
    const r = await app.request('/api/v1/buildings');
    const buildings = ((await r.json()) as { data: Building[] }).data;
    buildingId = buildings[0]!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  const list = async (qs: string): Promise<Response> =>
    app.request(`/api/v1/warning-dismissals${qs}`);

  const dismiss = async (body: unknown): Promise<Response> =>
    app.request('/api/v1/warning-dismissals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET without buildingId → 400', async () => {
    const r = await list('');
    assert.equal(r.status, 400);
  });

  it('GET returns [] for a building with no dismissals', async () => {
    const r = await list(`?buildingId=${buildingId}`);
    assert.equal(r.status, 200);
    const data = ((await r.json()) as { data: WarningDismissal[] }).data;
    assert.deepEqual(data, []);
  });

  it('POST records a dismissal; GET then returns it', async () => {
    const period = 1_900_000_000_000;
    const post = await dismiss({
      buildingId,
      kind: 'protection-monthly',
      periodStart: period,
    });
    assert.equal(post.status, 201);
    const created = ((await post.json()) as { data: WarningDismissal }).data;
    assert.equal(created.buildingId, buildingId);
    assert.equal(created.kind, 'protection-monthly');
    assert.equal(created.periodStart, period);

    const r = await list(`?buildingId=${buildingId}`);
    const data = ((await r.json()) as { data: WarningDismissal[] }).data;
    assert.equal(data.length, 1);
    assert.equal(data[0]?.periodStart, period);
  });

  it('POST is idempotent — double dismiss keeps a single row', async () => {
    const period = 1_900_000_000_000;
    const body = { buildingId, kind: 'protection-monthly', periodStart: period };
    assert.equal((await dismiss(body)).status, 201);
    assert.equal((await dismiss(body)).status, 201); // no error on re-dismiss

    const data = ((await (
      await list(`?buildingId=${buildingId}`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(data.length, 1);
  });

  it('a different period is a separate row (month rollover → banner returns)', async () => {
    const jan = 1_900_000_000_000;
    const feb = 1_902_678_400_000;
    await dismiss({ buildingId, kind: 'protection-monthly', periodStart: jan });
    // Next month, before the user dismisses again, only January is recorded.
    let data = ((await (
      await list(`?buildingId=${buildingId}&kind=protection-monthly`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(data.length, 1);
    assert.equal(data[0]?.periodStart, jan);
    assert.ok(!data.some((d) => d.periodStart === feb));

    // Dismiss February too → two distinct rows.
    await dismiss({ buildingId, kind: 'protection-monthly', periodStart: feb });
    data = ((await (
      await list(`?buildingId=${buildingId}&kind=protection-monthly`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(data.length, 2);
  });

  it('GET ?kind filters to that kind only', async () => {
    await dismiss({
      buildingId,
      kind: 'protection-monthly',
      periodStart: 1_900_000_000_000,
    });
    const match = ((await (
      await list(`?buildingId=${buildingId}&kind=protection-monthly`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(match.length, 1);
    const other = ((await (
      await list(`?buildingId=${buildingId}&kind=some-other-kind`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(other.length, 0);
  });

  it('POST rejects an unknown kind (zod 400)', async () => {
    const r = await dismiss({
      buildingId,
      kind: 'not-a-real-warning',
      periodStart: 1_900_000_000_000,
    });
    assert.equal(r.status, 400);
  });

  it('dismissals are building-scoped + cascade-delete with the building', async () => {
    // Make a second building and dismiss in it.
    const mk = await app.request('/api/v1/buildings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cabin' }),
    });
    const other = ((await mk.json()) as { data: Building }).data;
    await dismiss({
      buildingId: other.id,
      kind: 'protection-monthly',
      periodStart: 1_900_000_000_000,
    });

    // The default building still sees none.
    const def = ((await (
      await list(`?buildingId=${buildingId}`)
    ).json()) as { data: WarningDismissal[] }).data;
    assert.equal(def.length, 0);

    // Deleting the second building cascades its dismissals away.
    const del = await app.request(
      `/api/v1/buildings/${encodeURIComponent(other.id)}`,
      { method: 'DELETE' }
    );
    assert.equal(del.status, 204);
    const rows = await db.query(
      'SELECT 1 FROM warning_dismissals WHERE building_id = $1',
      [other.id]
    );
    assert.equal(rows.length, 0);
  });
});
