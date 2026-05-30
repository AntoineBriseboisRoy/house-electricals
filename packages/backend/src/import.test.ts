import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import type { Building, Component } from '@he/shared';
import { buildTestApp, createTestDb } from './test-helpers.js';
import type { BuildingExport } from './routes/export.js';

/**
 * G43 — building import/restore. Round-trip (export → import → re-export),
 * atomicity (mid-insert failure rolls everything back), envelope rejection,
 * and name-collision suffixing.
 */
describe('building import routes (G43 — 2026-05)', () => {
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

  const json = async <T>(res: Response): Promise<T> =>
    (await res.json()) as T;

  const defaultBuildingId = async (): Promise<string> => {
    const r = await app.request('/api/v1/buildings');
    return (await json<{ data: Building[] }>(r)).data[0].id; // seeded "My House"
  };

  const listBuildings = async (): Promise<Building[]> => {
    const r = await app.request('/api/v1/buildings');
    return (await json<{ data: Building[] }>(r)).data;
  };

  const exportJson = async (buildingId: string): Promise<BuildingExport> => {
    const r = await app.request(`/api/v1/buildings/${buildingId}/export.json`);
    assert.equal(r.status, 200);
    return json<BuildingExport>(r);
  };

  /**
   * Seed a rich building in the DEFAULT building:
   *  - 2 panels; panel B is a SUBPANEL fed by a breaker on panel A.
   *  - breakers incl. a double-pole, two tandem halves (a/b), and protection.
   *  - components: a wired+placed+critical outlet w/ load, a multi-gang switch
   *    controlling a light (switch_controls), a junction box.
   *  - a polygon room + a rectangle room, walls.
   *  - service_entries on BOTH a breaker AND a component, plus breaker_tests.
   */
  const seedRich = async (): Promise<{
    panelAId: string;
    panelBId: string;
    feederBreakerId: string;
    switchId: string;
    lightId: string;
    outletId: string;
  }> => {
    // Panel A (main).
    const panelA = (
      await json<{ data: { id: string } }>(
        await post('/api/v1/panels', { name: 'Main Panel' })
      )
    ).data;

    // Feeder breaker on panel A (double-pole) that will feed the subpanel.
    const feeder = (
      await json<{ data: { id: string } }>(
        await post(`/api/v1/panels/${panelA.id}/breakers`, {
          slot: '1',
          slotPosition: 1,
          amperage: 60,
          poles: 'double',
          label: 'Subpanel feeder',
        })
      )
    ).data;

    // A GFCI single-pole circuit on panel A.
    const circuit2 = (
      await json<{ data: { id: string } }>(
        await post(`/api/v1/panels/${panelA.id}/breakers`, {
          slot: '3',
          slotPosition: 3,
          amperage: 20,
          poles: 'single',
          label: 'Kitchen GFCI',
          protection: 'gfci',
        })
      )
    ).data;

    // Two tandem halves sharing slot 5 on panel A.
    const tandemA = (
      await json<{ data: { id: string } }>(
        await post(`/api/v1/panels/${panelA.id}/breakers`, {
          slot: '5',
          slotPosition: 5,
          amperage: 15,
          poles: 'tandem',
          tandemHalf: 'a',
          label: 'Bath',
        })
      )
    ).data;
    await post(`/api/v1/panels/${panelA.id}/breakers`, {
      slot: '5',
      slotPosition: 5,
      amperage: 15,
      poles: 'tandem',
      tandemHalf: 'b',
      label: 'Hall lights',
    });

    // Panel B (subpanel) — wire it to be fed by the feeder breaker.
    const panelB = (
      await json<{ data: { id: string } }>(
        await post('/api/v1/panels', { name: 'Garage Subpanel' })
      )
    ).data;
    await app.request(`/api/v1/panels/${panelB.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentBreakerId: feeder.id }),
    });
    // A breaker on the subpanel.
    const subBreaker = (
      await json<{ data: { id: string } }>(
        await post(`/api/v1/panels/${panelB.id}/breakers`, {
          slot: '1',
          slotPosition: 1,
          amperage: 20,
          poles: 'single',
          label: 'Garage outlets',
        })
      )
    ).data;

    // Floor + rooms (one polygon, one rectangle) + walls.
    const floor = (
      await json<{ data: { id: string } }>(
        await post('/api/v1/floors', { name: 'Main Floor' })
      )
    ).data;
    // L-shaped polygon room.
    await post(`/api/v1/floors/${floor.id}/rooms`, {
      name: 'Great Room',
      points: [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 1000 },
        { x: 1000, y: 1000 },
        { x: 1000, y: 2000 },
        { x: 0, y: 2000 },
      ],
    });
    // Rectangle room.
    await post(`/api/v1/floors/${floor.id}/rooms`, {
      name: 'Kitchen',
      x: 2000,
      y: 0,
      w: 1500,
      h: 1500,
    });
    await post(`/api/v1/floors/${floor.id}/walls`, {
      x1: 0,
      y1: 0,
      x2: 2000,
      y2: 0,
    });

    // Components.
    const outlet = (
      await json<{ data: Component }>(
        await post('/api/v1/components', {
          type: 'outlet',
          name: 'Kitchen outlet',
          room: 'Kitchen',
          breakerId: circuit2.id,
          floorId: floor.id,
          posX: 2500,
          posY: 500,
          critical: true,
          protection: 'gfci',
          loadWatts: 180,
        })
      )
    ).data;
    const sw = (
      await json<{ data: Component }>(
        await post('/api/v1/components', {
          type: 'switch',
          name: 'Hall switch',
          gangs: 2,
          floorId: floor.id,
          posX: 800,
          posY: 800,
        })
      )
    ).data;
    const light = (
      await json<{ data: Component }>(
        await post('/api/v1/components', {
          type: 'light',
          name: 'Hall light',
          floorId: floor.id,
          posX: 900,
          posY: 1200,
        })
      )
    ).data;
    // Junction box (no breaker, no floor) wired to the subpanel breaker.
    await post('/api/v1/components', {
      type: 'junction_box',
      name: 'Attic JB',
      breakerId: subBreaker.id,
    });

    // switch_controls: switch gang 0 → light, gang 1 → outlet.
    await post(`/api/v1/components/${sw.id}/controls`, {
      gangIndex: 0,
      controlledId: light.id,
    });
    await post(`/api/v1/components/${sw.id}/controls`, {
      gangIndex: 1,
      controlledId: outlet.id,
    });

    // breaker_tests on the feeder.
    await post(`/api/v1/breakers/${feeder.id}/breaker-tests`, {
      outcome: 'verified',
      notes: 'annual',
    });

    // service_entries on BOTH a breaker and a component (polymorphic).
    await post(`/api/v1/breakers/${circuit2.id}/service-entries`, {
      note: 'Replaced GFCI breaker',
    });
    await post(`/api/v1/components/${outlet.id}/service-entries`, {
      note: 'Replaced receptacle',
    });

    return {
      panelAId: panelA.id,
      panelBId: panelB.id,
      feederBreakerId: feeder.id,
      switchId: sw.id,
      lightId: light.id,
      outletId: outlet.id,
    };
  };

  /** Structural fingerprint of an export, MODULO ids — the cross-reference
   *  graph rebuilt from names so two trees are comparable across remapped ids. */
  const structuralShape = (e: BuildingExport) => {
    const panelName = new Map(e.panels.map((p) => [p.id, p.name]));
    const breakerLabel = new Map(e.breakers.map((b) => [b.id, b.label]));
    const componentName = new Map(e.components.map((c) => [c.id, c.name]));

    return {
      buildingName: e.building.name,
      floors: [...e.floors.map((f) => f.name)].sort(),
      rooms: [...e.rooms.map((r) => ({ name: r.name, points: r.points }))].sort(
        (a, b) => a.name.localeCompare(b.name)
      ),
      walls: e.walls.length,
      panels: e.panels
        .map((p) => ({
          name: p.name,
          orientation: p.orientation,
          slotCount: p.slotCount,
          // feeder breaker by LABEL (id-independent).
          feeder:
            p.parentBreakerId === null
              ? null
              : breakerLabel.get(p.parentBreakerId) ?? '<dangling>',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      breakers: e.breakers
        .map((b) => ({
          label: b.label,
          panel: panelName.get(b.panelId) ?? '<dangling>',
          slot: b.slot,
          slotPosition: b.slotPosition,
          amperage: b.amperage,
          poles: b.poles,
          tandemHalf: b.tandemHalf,
          protection: b.protection,
        }))
        .sort((a, b) =>
          (a.label + a.tandemHalf).localeCompare(b.label + b.tandemHalf)
        ),
      components: e.components
        .map((c) => ({
          name: c.name,
          type: c.type,
          room: c.room,
          critical: c.critical,
          protection: c.protection,
          loadWatts: c.loadWatts,
          gangs: c.gangs,
          posX: c.posX,
          posY: c.posY,
          // wiring by breaker LABEL (id-independent).
          breaker:
            c.breakerId === null
              ? null
              : breakerLabel.get(c.breakerId) ?? '<dangling>',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      switchControls: e.switchControls
        .map((sc) => ({
          switch: componentName.get(sc.switchId) ?? '<dangling>',
          controlled: componentName.get(sc.controlledId) ?? '<dangling>',
          gangIndex: sc.gangIndex,
        }))
        .sort((a, b) =>
          (a.switch + a.controlled + a.gangIndex).localeCompare(
            b.switch + b.controlled + b.gangIndex
          )
        ),
      serviceEntries: e.serviceEntries
        .map((se) => ({
          parentType: se.parentType,
          note: se.note,
          // parent by name/label (id-independent), per parentType.
          parent:
            se.parentType === 'breaker'
              ? breakerLabel.get(se.parentId) ?? '<dangling>'
              : componentName.get(se.parentId) ?? '<dangling>',
        }))
        .sort((a, b) => a.note.localeCompare(b.note)),
      breakerTests: e.breakerTests
        .map((bt) => ({
          breaker: breakerLabel.get(bt.breakerId) ?? '<dangling>',
          outcome: bt.outcome,
          notes: bt.notes,
        }))
        .sort((a, b) => (a.outcome ?? '').localeCompare(b.outcome ?? '')),
    };
  };

  it('round-trips the full tree under a new building with remapped cross-refs', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);

    const res = await post('/api/v1/buildings/import', srcExport);
    assert.equal(res.status, 201);
    const newBuilding = (await json<{ data: Building }>(res)).data;
    // A genuinely NEW building.
    assert.notEqual(newBuilding.id, srcId);
    assert.equal(newBuilding.name, `${srcExport.building.name} (imported)`);

    const newExport = await exportJson(newBuilding.id);

    // No id from the source survives into the new tree (everything remapped).
    const srcIds = new Set<string>([
      srcExport.building.id,
      ...srcExport.panels.map((p) => p.id),
      ...srcExport.breakers.map((b) => b.id),
      ...srcExport.components.map((c) => c.id),
      ...srcExport.floors.map((f) => f.id),
      ...srcExport.rooms.map((r) => r.id),
      ...srcExport.walls.map((w) => w.id),
    ]);
    const newIds = [
      newExport.building.id,
      ...newExport.panels.map((p) => p.id),
      ...newExport.breakers.map((b) => b.id),
      ...newExport.components.map((c) => c.id),
      ...newExport.floors.map((f) => f.id),
      ...newExport.rooms.map((r) => r.id),
      ...newExport.walls.map((w) => w.id),
    ];
    for (const id of newIds) {
      assert.ok(!srcIds.has(id), `new id ${id} collided with a source id`);
    }

    // Structurally identical modulo ids (wiring, feeders, switch_controls,
    // polymorphic service_entries, breaker_tests, polygon room points).
    const srcShape = structuralShape(srcExport);
    const newShape = structuralShape(newExport);
    // Building name differs (collision suffix) — compare the rest.
    srcShape.buildingName = newShape.buildingName;
    assert.deepEqual(newShape, srcShape);

    // Spot-check a couple of the trickier remaps explicitly.
    // (a) The subpanel's feeder resolves to a real breaker in the NEW tree.
    const newSub = newExport.panels.find((p) => p.name === 'Garage Subpanel');
    assert.ok(newSub);
    assert.notEqual(newSub.parentBreakerId, null);
    assert.ok(
      newExport.breakers.some((b) => b.id === newSub.parentBreakerId),
      'feeder breaker id resolves within the new tree'
    );
    // (b) Both service_entries parents resolve within their correct dict.
    const seBreaker = newExport.serviceEntries.find(
      (se) => se.parentType === 'breaker'
    );
    const seComponent = newExport.serviceEntries.find(
      (se) => se.parentType === 'component'
    );
    assert.ok(seBreaker && newExport.breakers.some((b) => b.id === seBreaker.parentId));
    assert.ok(
      seComponent && newExport.components.some((c) => c.id === seComponent.parentId)
    );
  });

  it('is atomic — a dangling cross-ref rolls the whole import back', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);

    const buildingsBefore = (await listBuildings()).length;

    // Corrupt the payload: point a service_entry (parent_type='breaker') at a
    // breaker id that ISN'T in the breakers array. The remap throws mid-
    // transaction → everything rolls back.
    const corrupt: BuildingExport = {
      ...srcExport,
      building: { ...srcExport.building, name: 'Atomicity Test Building' },
      serviceEntries: [
        ...srcExport.serviceEntries,
        {
          id: 'se-bad',
          parentType: 'breaker',
          parentId: 'breaker-that-does-not-exist',
          occurredAt: Date.now(),
          note: 'dangling',
          createdAt: Date.now(),
        },
      ],
    };

    const res = await post('/api/v1/buildings/import', corrupt);
    assert.notEqual(res.status, 201);

    // No new building (and therefore no orphan panels/floors) was committed.
    const after = await listBuildings();
    assert.equal(after.length, buildingsBefore);
    assert.ok(!after.some((b) => b.name === 'Atomicity Test Building'));
    assert.ok(!after.some((b) => b.name === 'Atomicity Test Building (imported)'));
  });

  it('rejects payloads with a wrong/unsupported/missing envelope', async () => {
    const wrongFormat = await post('/api/v1/buildings/import', {
      format: 'wrong',
      version: 1,
      exportedAt: 0,
    });
    assert.equal(wrongFormat.status, 400);
    assert.match(
      (await json<{ error: { message: string } }>(wrongFormat)).error.message,
      /Not a House Electricals building export\./
    );

    const wrongVersion = await post('/api/v1/buildings/import', {
      format: 'house-electricals-building-export',
      version: 2,
      exportedAt: 0,
    });
    assert.equal(wrongVersion.status, 400);
    assert.equal(
      (await json<{ error: { message: string } }>(wrongVersion)).error.message,
      'Unsupported export version 2.'
    );

    const empty = await post('/api/v1/buildings/import', {});
    assert.equal(empty.status, 400);
    assert.match(
      (await json<{ error: { message: string } }>(empty)).error.message,
      /Invalid export file\./
    );
  });

  it('suffixes the building name on collision (re-import = fresh copy)', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);
    const baseName = srcExport.building.name;

    // First import: name collides with the source → "<name> (imported)".
    const r1 = await post('/api/v1/buildings/import', srcExport);
    assert.equal(r1.status, 201);
    const b1 = (await json<{ data: Building }>(r1)).data;
    assert.equal(b1.name, `${baseName} (imported)`);

    // Second import: collides with source AND the first import → "(imported 2)".
    const r2 = await post('/api/v1/buildings/import', srcExport);
    assert.equal(r2.status, 201);
    const b2 = (await json<{ data: Building }>(r2)).data;
    assert.equal(b2.name, `${baseName} (imported 2)`);

    // Both new buildings exist independently alongside the source.
    const all = await listBuildings();
    assert.ok(all.some((b) => b.id === srcId && b.name === baseName));
    assert.ok(all.some((b) => b.id === b1.id));
    assert.ok(all.some((b) => b.id === b2.id));
    assert.notEqual(b1.id, b2.id);
  });

  // audit/harden — locks the floors.panel_id second-pass fix (was silently
  // DROPPED: inserted NULL with no second pass restoring it). The cycle-85
  // floor→default-panel link must survive the round-trip, remapped.
  it('round-trips floors.panelId (the floor→default-panel link)', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);
    // The seed doesn't set a floor→panel link; inject one pointing at a real
    // source panel so the import has something to remap.
    const srcPanel = srcExport.panels[0];
    const linked: BuildingExport = {
      ...srcExport,
      floors: srcExport.floors.map((f, i) =>
        i === 0 ? { ...f, panelId: srcPanel.id } : f
      ),
    };

    const res = await post('/api/v1/buildings/import', linked);
    assert.equal(res.status, 201);
    const newBuilding = (await json<{ data: Building }>(res)).data;
    const newExport = await exportJson(newBuilding.id);

    const linkedFloor = newExport.floors.find((f) => f.panelId !== null);
    assert.ok(linkedFloor, 'a floor with a non-null panelId must exist');
    // The remapped panelId must point at a panel that actually exists in the
    // NEW tree, and carry the SAME name as the source-linked panel.
    const target = newExport.panels.find((p) => p.id === linkedFloor.panelId);
    assert.ok(target, 'floor.panelId must resolve to a panel in the new tree');
    assert.equal(target.name, srcPanel.name);
  });

  // audit/harden — locks the try/catch fix: a payload fault is a 400 with a
  // readable { error: { message } } envelope, NOT a bare 500.
  it('returns a 400 + readable envelope on an inconsistent payload', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);
    const corrupt: BuildingExport = {
      ...srcExport,
      serviceEntries: [
        ...srcExport.serviceEntries,
        {
          id: 'se-bad',
          parentType: 'breaker',
          parentId: 'breaker-that-does-not-exist',
          occurredAt: Date.now(),
          note: 'dangling',
          createdAt: Date.now(),
        },
      ],
    };
    const res = await post('/api/v1/buildings/import', corrupt);
    assert.equal(res.status, 400);
    const body = await json<{ error?: { message?: string } }>(res);
    assert.equal(typeof body.error?.message, 'string');
    assert.match(body.error?.message ?? '', /could not import/i);
  });

  // audit/harden — locks the ON CONFLICT DO NOTHING fix: a duplicate
  // switch_controls triple must not abort the whole import.
  it('tolerates a duplicate switch_controls triple', async () => {
    await seedRich();
    const srcId = await defaultBuildingId();
    const srcExport = await exportJson(srcId);
    const uniqueCount = srcExport.switchControls.length;
    assert.ok(uniqueCount >= 1, 'seed should have switch controls');
    const dup: BuildingExport = {
      ...srcExport,
      switchControls: [srcExport.switchControls[0], ...srcExport.switchControls],
    };
    const res = await post('/api/v1/buildings/import', dup);
    assert.equal(res.status, 201, 'a duplicate triple must not abort the import');
    const newBuilding = (await json<{ data: Building }>(res)).data;
    const newExport = await exportJson(newBuilding.id);
    assert.equal(
      newExport.switchControls.length,
      uniqueCount,
      'the duplicate should collapse — same unique count as the source'
    );
  });
});
