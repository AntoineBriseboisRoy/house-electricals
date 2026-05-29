import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Building, Component } from '@he/shared';
import { buildTestApp, createTestDb } from './test-helpers.js';
import type { BuildingExport } from './routes/export.js';

describe('building export routes (2026-05)', () => {
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

  const post = async (path: string, body: unknown): Promise<Response> =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const defaultBuildingId = async (): Promise<string> => {
    const r = await app.request('/api/v1/buildings');
    const list = ((await r.json()) as { data: Building[] }).data;
    return list[0].id; // the seeded "My House"
  };

  /** Seed a panel + 2 breakers + floor + room + wall + components +
   *  switch_control + breaker_test + service_entry in the DEFAULT building. */
  const seedDefault = async (): Promise<{
    panelId: string;
    breakerIds: string[];
    floorId: string;
    switchId: string;
    lightId: string;
  }> => {
    const panel = ((await (await post('/api/v1/panels', { name: 'Main Panel' })).json()) as {
      data: { id: string };
    }).data;
    const breakerIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const b = ((await (
        await post(`/api/v1/panels/${panel.id}/breakers`, {
          slot: String(i),
          slotPosition: i,
          amperage: 20,
          poles: 'single',
          label: `Circuit ${i}`,
        })
      ).json()) as { data: { id: string } }).data;
      breakerIds.push(b.id);
    }
    const floor = ((await (await post('/api/v1/floors', { name: 'Main Floor' })).json()) as {
      data: { id: string };
    }).data;
    await post(`/api/v1/floors/${floor.id}/rooms`, {
      name: 'Kitchen',
      x: 0,
      y: 0,
      w: 1000,
      h: 1000,
    });
    await post(`/api/v1/floors/${floor.id}/walls`, {
      x1: 0,
      y1: 0,
      x2: 1000,
      y2: 0,
    });
    // A wired outlet (with a load), a switch + a controlled light.
    const outlet = ((await (
      await post('/api/v1/components', {
        type: 'outlet',
        name: 'Kitchen outlet',
        room: 'Kitchen',
        breakerId: breakerIds[0],
        loadWatts: 180,
      })
    ).json()) as { data: Component }).data;
    const sw = ((await (
      await post('/api/v1/components', { type: 'switch', name: 'Hall switch' })
    ).json()) as { data: Component }).data;
    const light = ((await (
      await post('/api/v1/components', { type: 'light', name: 'Hall light' })
    ).json()) as { data: Component }).data;
    await post(`/api/v1/components/${sw.id}/controls`, {
      gangIndex: 0,
      controlledId: light.id,
    });
    await post(`/api/v1/breakers/${breakerIds[0]}/breaker-tests`, {
      outcome: 'verified',
    });
    await post(`/api/v1/components/${outlet.id}/service-entries`, {
      note: 'Replaced receptacle',
    });
    return {
      panelId: panel.id,
      breakerIds,
      floorId: floor.id,
      switchId: sw.id,
      lightId: light.id,
    };
  };

  it('export.json returns the full building tree as an attachment', async () => {
    const seeded = await seedDefault();
    const buildingId = await defaultBuildingId();

    const res = await app.request(`/api/v1/buildings/${buildingId}/export.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /attachment; filename=".*\.json"/
    );

    const data = (await res.json()) as BuildingExport;
    assert.equal(data.format, 'house-electricals-building-export');
    assert.equal(data.building.id, buildingId);
    assert.equal(data.panels.length, 1);
    assert.equal(data.panels[0].id, seeded.panelId);
    assert.equal(data.breakers.length, 2);
    assert.equal(data.floors.length, 1);
    assert.equal(data.rooms.length, 1);
    assert.equal(data.walls.length, 1);
    assert.equal(data.components.length, 3);
    // The resolved `breaker` summary is stripped from exported components.
    assert.ok(!('breaker' in (data.components[0] as object)));
    assert.equal(data.switchControls.length, 1);
    assert.equal(data.switchControls[0].switchId, seeded.switchId);
    assert.equal(data.switchControls[0].controlledId, seeded.lightId);
    assert.equal(data.breakerTests.length, 1);
    assert.equal(data.breakerTests[0].breakerId, seeded.breakerIds[0]);
    assert.equal(data.serviceEntries.length, 1);
    assert.equal(data.serviceEntries[0].note, 'Replaced receptacle');
  });

  it('export.csv returns a circuit directory with a row per wired component', async () => {
    await seedDefault();
    const buildingId = await defaultBuildingId();

    const res = await app.request(`/api/v1/buildings/${buildingId}/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /attachment; filename=".*\.csv"/
    );

    const text = await res.text();
    const lines = text.trim().split(/\r\n/);
    // Header + 2 breakers (one with the outlet wired, one bare).
    assert.match(lines[0], /^Panel,Slot,Amperage,Poles,Breaker Label,Protection,Component,Type,Room,Load \(W\)$/);
    assert.equal(lines.length, 3);
    assert.ok(text.includes('Main Panel'));
    assert.ok(text.includes('Kitchen outlet'));
    assert.ok(text.includes('180')); // the load
  });

  it('scopes strictly to the requested building', async () => {
    await seedDefault();
    const defId = await defaultBuildingId();

    // Second building with its own panel + breaker + component.
    const garage = ((await (await post('/api/v1/buildings', { name: 'Garage' })).json()) as {
      data: { id: string };
    }).data;
    const gp = ((await (
      await post('/api/v1/panels', { name: 'Garage Panel', buildingId: garage.id })
    ).json()) as { data: { id: string } }).data;
    await post(`/api/v1/panels/${gp.id}/breakers`, {
      slot: '1',
      slotPosition: 1,
      amperage: 15,
      poles: 'single',
      label: 'Garage circuit',
    });
    await post('/api/v1/components', {
      type: 'outlet',
      name: 'Garage outlet',
      buildingId: garage.id,
    });

    // Default export excludes garage data.
    const defData = (await (
      await app.request(`/api/v1/buildings/${defId}/export.json`)
    ).json()) as BuildingExport;
    assert.equal(defData.panels.length, 1);
    assert.ok(defData.panels.every((p) => p.id !== gp.id));
    assert.ok(defData.components.every((c) => c.name !== 'Garage outlet'));

    // Garage export contains ONLY garage data.
    const garData = (await (
      await app.request(`/api/v1/buildings/${garage.id}/export.json`)
    ).json()) as BuildingExport;
    assert.equal(garData.building.id, garage.id);
    assert.equal(garData.panels.length, 1);
    assert.equal(garData.panels[0].id, gp.id);
    assert.equal(garData.components.length, 1);
    assert.equal(garData.components[0].name, 'Garage outlet');
  });

  it('returns 404 for an unknown building', async () => {
    const r1 = await app.request('/api/v1/buildings/nope/export.json');
    assert.equal(r1.status, 404);
    const r2 = await app.request('/api/v1/buildings/nope/export.csv');
    assert.equal(r2.status, 404);
  });
});
