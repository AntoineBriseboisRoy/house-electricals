import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Building, Panel } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

describe('building routes (2026-05 multi-building)', () => {
  let cleanup: () => Promise<void>;
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    await cleanup();
  });

  const listBuildings = async (): Promise<Building[]> =>
    ((await (await app.request('/api/v1/buildings')).json()) as { data: Building[] }).data;

  const createBuilding = async (name: string): Promise<Building> => {
    const r = await app.request('/api/v1/buildings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.equal(r.status, 201);
    return ((await r.json()) as { data: Building }).data;
  };

  const createPanel = async (name: string, buildingId: string): Promise<Response> =>
    app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, buildingId }),
    });

  it('seeds a single default "My House" building', async () => {
    const buildings = await listBuildings();
    assert.equal(buildings.length, 1);
    assert.equal(buildings[0]?.name, 'My House');
  });

  it('POST creates a building; duplicate name → 409', async () => {
    const b = await createBuilding('Garage');
    assert.equal(b.name, 'Garage');
    const dup = await app.request('/api/v1/buildings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Garage' }),
    });
    assert.equal(dup.status, 409);
  });

  it('PATCH renames a building', async () => {
    const b = await createBuilding('Cottage');
    const res = await app.request(`/api/v1/buildings/${b.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lake Cottage' }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { data: Building }).data.name, 'Lake Cottage');
  });

  it('refuses to delete the only building (409)', async () => {
    const buildings = await listBuildings();
    assert.equal(buildings.length, 1);
    const res = await app.request(`/api/v1/buildings/${buildings[0]!.id}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 409);
  });

  it('panel names are unique PER building, not globally', async () => {
    const defaultId = (await listBuildings())[0]!.id;
    const garage = await createBuilding('Garage');
    assert.equal((await createPanel('Main Panel', defaultId)).status, 201);
    // Same name in a DIFFERENT building → allowed.
    assert.equal((await createPanel('Main Panel', garage.id)).status, 201);
    // Same name AGAIN in the garage → 409.
    assert.equal((await createPanel('Main Panel', garage.id)).status, 409);
  });

  it('GET /panels?buildingId scopes to one building', async () => {
    const defaultId = (await listBuildings())[0]!.id;
    const garage = await createBuilding('Garage');
    await createPanel('Default Panel', defaultId);
    await createPanel('Garage Panel', garage.id);

    const scoped = (await (
      await app.request(`/api/v1/panels?buildingId=${garage.id}`)
    ).json()) as { data: Panel[] };
    assert.equal(scoped.data.length, 1);
    assert.equal(scoped.data[0]?.name, 'Garage Panel');

    const all = (await (await app.request('/api/v1/panels')).json()) as { data: Panel[] };
    assert.equal(all.data.length, 2); // unscoped → all buildings
  });

  it('deleting a building cascades its panels + breakers', async () => {
    const garage = await createBuilding('Garage');
    const p = await createPanel('Sub', garage.id);
    const panelId = ((await p.json()) as { data: Panel }).data.id;
    // A breaker exercises the panels→breakers edge (no DB-level CASCADE there).
    const br = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 20, poles: 'single', label: 'Lights' }),
    });
    assert.equal(br.status, 201);

    const del = await app.request(`/api/v1/buildings/${garage.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    // Panel (and its breaker) are gone, building is gone.
    const panelsLeft = (await (
      await app.request(`/api/v1/panels?buildingId=${garage.id}`)
    ).json()) as { data: Panel[] };
    assert.equal(panelsLeft.data.length, 0);
    const breakersLeft = await db.query<{ id: string }>(
      'SELECT id FROM breakers WHERE panel_id = $1',
      [panelId]
    );
    assert.equal(breakersLeft.length, 0);
    assert.equal((await listBuildings()).some((b) => b.id === garage.id), false);
  });

  it('moving a panel relocates it + its wired components to the target building', async () => {
    const defaultId = (await listBuildings())[0]!.id;
    const garage = await createBuilding('Garage');
    const panelId = ((await (await createPanel('Sub', defaultId)).json()) as {
      data: Panel;
    }).data.id;
    const brRes = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: '1', amperage: 15, poles: 'single', label: 'Lights' }),
    });
    const breakerId = ((await brRes.json()) as { data: { id: string } }).data.id;
    await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'outlet',
        name: 'Wired outlet',
        breakerId,
        buildingId: defaultId,
      }),
    });

    const move = await app.request(`/api/v1/panels/${panelId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildingId: garage.id }),
    });
    assert.equal(move.status, 200);

    const inGarage = (await (
      await app.request(`/api/v1/panels?buildingId=${garage.id}`)
    ).json()) as { data: Panel[] };
    assert.equal(inGarage.data.some((p) => p.id === panelId), true);
    const inDefault = (await (
      await app.request(`/api/v1/panels?buildingId=${defaultId}`)
    ).json()) as { data: Panel[] };
    assert.equal(inDefault.data.some((p) => p.id === panelId), false);
    // The wired component followed the panel into the new building.
    const comps = (await (
      await app.request(`/api/v1/components?buildingId=${garage.id}`)
    ).json()) as { data: { name: string }[] };
    assert.equal(comps.data.some((c) => c.name === 'Wired outlet'), true);
  });

  it('moving a floor relocates it + its placed components', async () => {
    const defaultId = (await listBuildings())[0]!.id;
    const garage = await createBuilding('Garage');
    const floorRes = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Attic', buildingId: defaultId }),
    });
    const floorId = ((await floorRes.json()) as { data: { id: string } }).data.id;
    await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'light',
        name: 'Attic light',
        floorId,
        posX: 100,
        posY: 100,
        buildingId: defaultId,
      }),
    });

    const move = await app.request(`/api/v1/floors/${floorId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildingId: garage.id }),
    });
    assert.equal(move.status, 200);

    const floorsInGarage = (await (
      await app.request(`/api/v1/floors?buildingId=${garage.id}`)
    ).json()) as { data: { id: string }[] };
    assert.equal(floorsInGarage.data.some((f) => f.id === floorId), true);
    const comps = (await (
      await app.request(`/api/v1/components?buildingId=${garage.id}`)
    ).json()) as { data: { name: string }[] };
    assert.equal(comps.data.some((c) => c.name === 'Attic light'), true);
  });

  it('moving to a non-existent building → 400', async () => {
    const defaultId = (await listBuildings())[0]!.id;
    const panelId = ((await (await createPanel('Solo', defaultId)).json()) as {
      data: Panel;
    }).data.id;
    const res = await app.request(`/api/v1/panels/${panelId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildingId: 'does-not-exist' }),
    });
    assert.equal(res.status, 400);
  });
});
