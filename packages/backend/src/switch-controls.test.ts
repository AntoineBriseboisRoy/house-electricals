import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Component,
  Floor,
  ResolvedSwitchControl,
  SwitchControl,
} from '@he/shared';
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

describe('switch_controls routes (G19)', () => {
  let dir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-sc-'));
    db = openDatabase(join(dir, 's.db'));
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
      auth: null,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const createComp = async (
    body: { type: string; name: string; gangs?: number }
  ): Promise<Component> => {
    const r = await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await r.json()) as { data: Component }).data;
  };

  it('create switch with gangs=3 + link a light to gang 0', async () => {
    const sw = await createComp({ type: 'switch', name: 'Kitchen', gangs: 3 });
    const light = await createComp({ type: 'light', name: 'Pantry light' });
    assert.equal(sw.gangs, 3);

    const link = await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: light.id }),
    });
    assert.equal(link.status, 201);
    const linkBody = (await link.json()) as { data: ResolvedSwitchControl };
    assert.equal(linkBody.data.gangIndex, 0);
    assert.equal(linkBody.data.controlled.id, light.id);
  });

  it('GET /components/:id/controls returns resolved links', async () => {
    const sw = await createComp({ type: 'switch', name: 'S', gangs: 2 });
    const l1 = await createComp({ type: 'light', name: 'L1' });
    const o1 = await createComp({ type: 'outlet', name: 'O1' });
    await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: l1.id }),
    });
    await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 1, controlledId: o1.id }),
    });

    const r = await app.request(`/api/v1/components/${sw.id}/controls`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { data: ResolvedSwitchControl[] };
    assert.equal(body.data.length, 2);
    assert.deepEqual(
      body.data.map((x) => [x.gangIndex, x.controlled.id]).sort(),
      [
        [0, l1.id],
        [1, o1.id],
      ]
    );
  });

  it('rejects gangIndex out of range for this switch', async () => {
    const sw = await createComp({ type: 'switch', name: 'S', gangs: 1 });
    const l = await createComp({ type: 'light', name: 'L' });
    const r = await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 1, controlledId: l.id }),
    });
    assert.equal(r.status, 400);
  });

  it('rejects non-switch source component', async () => {
    const o = await createComp({ type: 'outlet', name: 'O' });
    const l = await createComp({ type: 'light', name: 'L' });
    const r = await app.request(`/api/v1/components/${o.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: l.id }),
    });
    assert.equal(r.status, 400);
  });

  it('rejects controlled component that is not a light or outlet', async () => {
    const sw = await createComp({ type: 'switch', name: 'S' });
    const app1 = await createComp({ type: 'appliance', name: 'Fridge' });
    const r = await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: app1.id }),
    });
    assert.equal(r.status, 400);
  });

  it('DELETE removes a single link', async () => {
    const sw = await createComp({ type: 'switch', name: 'S', gangs: 2 });
    const l = await createComp({ type: 'light', name: 'L' });
    await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 1, controlledId: l.id }),
    });
    const d = await app.request(
      `/api/v1/components/${sw.id}/controls/1/${l.id}`,
      { method: 'DELETE' }
    );
    assert.equal(d.status, 204);
    const list = ((await (
      await app.request(`/api/v1/components/${sw.id}/controls`)
    ).json()) as { data: ResolvedSwitchControl[] }).data;
    assert.equal(list.length, 0);
  });

  it('cascade: deleting the switch removes its control rows', async () => {
    const sw = await createComp({ type: 'switch', name: 'S' });
    const l = await createComp({ type: 'light', name: 'L' });
    await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: l.id }),
    });
    await app.request(`/api/v1/components/${sw.id}`, { method: 'DELETE' });
    type CountRow = { n: number };
    const remaining = (
      db.prepare('SELECT COUNT(*) AS n FROM switch_controls').get() as CountRow
    ).n;
    assert.equal(remaining, 0);
  });

  // Refactor 2026-05 follow-up — switch + controlled share one circuit.
  // Two propagation paths: (a) wiring a switch propagates to all controlled,
  // (b) adding a control link to a wired switch propagates immediately.
  describe('switch+controlled breaker propagation (refactor 2026-05)', () => {
    const createPanelAndBreakers = async (
      count: number
    ): Promise<{ panelId: string; breakerIds: string[] }> => {
      const panelRes = await app.request('/api/v1/panels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `P-${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      const panel = ((await panelRes.json()) as { data: { id: string } }).data;
      const ids: string[] = [];
      for (let i = 1; i <= count; i++) {
        const r = await app.request(
          `/api/v1/panels/${panel.id}/breakers`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              slot: String(i),
              slotPosition: i,
              amperage: 20,
              poles: 'single',
              label: `L${i}`,
            }),
          }
        );
        ids.push(((await r.json()) as { data: { id: string } }).data.id);
      }
      return { panelId: panel.id, breakerIds: ids };
    };

    const getComp = async (id: string): Promise<Component> => {
      const r = await app.request(`/api/v1/components/${id}`);
      return ((await r.json()) as { data: Component }).data;
    };

    it('PATCH switch.breakerId propagates to every controlled component', async () => {
      const { breakerIds } = await createPanelAndBreakers(2);
      const sw = await createComp({ type: 'switch', name: 'S', gangs: 2 });
      const l1 = await createComp({ type: 'light', name: 'L1' });
      const l2 = await createComp({ type: 'light', name: 'L2' });
      // Two control links from one switch.
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: l1.id }),
      });
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 1, controlledId: l2.id }),
      });
      // Patch switch to breaker #1 → both lights follow.
      const patchRes = await app.request(`/api/v1/components/${sw.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[0] }),
      });
      assert.equal(patchRes.status, 200);
      assert.equal((await getComp(sw.id)).breakerId, breakerIds[0]);
      assert.equal((await getComp(l1.id)).breakerId, breakerIds[0]);
      assert.equal((await getComp(l2.id)).breakerId, breakerIds[0]);
      // Re-patch to breaker #2 → both lights follow.
      await app.request(`/api/v1/components/${sw.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[1] }),
      });
      assert.equal((await getComp(l1.id)).breakerId, breakerIds[1]);
      assert.equal((await getComp(l2.id)).breakerId, breakerIds[1]);
      // Patch to null → both lights also null.
      await app.request(`/api/v1/components/${sw.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: null }),
      });
      assert.equal((await getComp(sw.id)).breakerId, null);
      assert.equal((await getComp(l1.id)).breakerId, null);
      assert.equal((await getComp(l2.id)).breakerId, null);
    });

    it('POST switch_control syncs the new controlled to the switch\'s current breaker', async () => {
      const { breakerIds } = await createPanelAndBreakers(1);
      const sw = await createComp({ type: 'switch', name: 'S' });
      const light = await createComp({ type: 'light', name: 'L' });
      // Wire the switch first.
      await app.request(`/api/v1/components/${sw.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[0] }),
      });
      // Light is still unwired at this point.
      assert.equal((await getComp(light.id)).breakerId, null);
      // Link the light → it picks up the switch's breaker.
      const r = await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: light.id }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { data: ResolvedSwitchControl };
      assert.equal(body.data.controlled.breakerId, breakerIds[0]);
      // Persisted in the row too (not just the response).
      assert.equal((await getComp(light.id)).breakerId, breakerIds[0]);
    });

    it('POST switch_control when switch is unwired drops the controlled to null', async () => {
      const { breakerIds } = await createPanelAndBreakers(1);
      const sw = await createComp({ type: 'switch', name: 'S' });
      // Pre-wire the light to some breaker manually.
      const light = await createComp({ type: 'light', name: 'L' });
      await app.request(`/api/v1/components/${light.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[0] }),
      });
      assert.equal((await getComp(light.id)).breakerId, breakerIds[0]);
      // Now link the light to the unwired switch. Per the
      // "switch and controlled always share one breaker" invariant, the
      // light's breakerId is reset to null to match the switch.
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: light.id }),
      });
      assert.equal((await getComp(light.id)).breakerId, null);
    });

    it('non-switch breakerId patches do NOT trigger propagation', async () => {
      const { breakerIds } = await createPanelAndBreakers(2);
      const sw = await createComp({ type: 'switch', name: 'S' });
      const light = await createComp({ type: 'light', name: 'L' });
      // Wire the switch + add a control so light = breaker[0] via propagation.
      await app.request(`/api/v1/components/${sw.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[0] }),
      });
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: light.id }),
      });
      assert.equal((await getComp(light.id)).breakerId, breakerIds[0]);
      // PATCH the LIGHT to breaker[1] directly — should NOT reverse-propagate
      // to the switch. Only switch → controlled is the auto direction.
      await app.request(`/api/v1/components/${light.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ breakerId: breakerIds[1] }),
      });
      assert.equal((await getComp(light.id)).breakerId, breakerIds[1]);
      assert.equal((await getComp(sw.id)).breakerId, breakerIds[0]);
    });
  });

  it('cascade: deleting the controlled component removes its control rows', async () => {
    const sw = await createComp({ type: 'switch', name: 'S' });
    const l = await createComp({ type: 'light', name: 'L' });
    await app.request(`/api/v1/components/${sw.id}/controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex: 0, controlledId: l.id }),
    });
    await app.request(`/api/v1/components/${l.id}`, { method: 'DELETE' });
    type CountRow = { n: number };
    const remaining = (
      db.prepare('SELECT COUNT(*) AS n FROM switch_controls').get() as CountRow
    ).n;
    assert.equal(remaining, 0);
  });

  // G38 cycle-64 — flat per-floor list endpoint.
  describe('GET /switch-controls?floorId (G38 cycle-64)', () => {
    const createCompFull = async (body: {
      type: string;
      name: string;
      gangs?: number;
      floorId?: string;
    }): Promise<Component> => {
      const r = await app.request('/api/v1/components', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return ((await r.json()) as { data: Component }).data;
    };

    const createFloor = async (name: string): Promise<Floor> => {
      const r = await app.request('/api/v1/floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return ((await r.json()) as { data: Floor }).data;
    };

    it('returns controls where either switch or controlled is on the floor', async () => {
      const f = await createFloor('Floor A');
      const sw = await createCompFull({
        type: 'switch',
        name: 'A-switch',
        floorId: f.id,
      });
      const l = await createCompFull({
        type: 'light',
        name: 'A-light',
        floorId: f.id,
      });
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: l.id }),
      });

      const r = await app.request(
        `/api/v1/switch-controls?floorId=${f.id}`
      );
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: SwitchControl[] };
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].switchId, sw.id);
      assert.equal(body.data[0].controlledId, l.id);
      assert.equal(body.data[0].gangIndex, 0);
    });

    it('excludes controls from other floors', async () => {
      const fa = await createFloor('Floor A');
      const fb = await createFloor('Floor B');
      // Floor A pair
      const swA = await createCompFull({
        type: 'switch',
        name: 'A-sw',
        floorId: fa.id,
      });
      const lA = await createCompFull({
        type: 'light',
        name: 'A-light',
        floorId: fa.id,
      });
      await app.request(`/api/v1/components/${swA.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: lA.id }),
      });
      // Floor B pair (should NOT appear when querying Floor A)
      const swB = await createCompFull({
        type: 'switch',
        name: 'B-sw',
        floorId: fb.id,
      });
      const lB = await createCompFull({
        type: 'light',
        name: 'B-light',
        floorId: fb.id,
      });
      await app.request(`/api/v1/components/${swB.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: lB.id }),
      });

      const r = await app.request(
        `/api/v1/switch-controls?floorId=${fa.id}`
      );
      assert.equal(r.status, 200);
      const body = (await r.json()) as { data: SwitchControl[] };
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].switchId, swA.id);
      assert.equal(body.data[0].controlledId, lA.id);
    });

    it('includes a control row when only the controlled (light) is on the floor', async () => {
      // Edge case: switch lives on Floor B, light on Floor A → querying
      // Floor A should still surface the row because the LIGHT lives there.
      const fa = await createFloor('Floor A');
      const fb = await createFloor('Floor B');
      const sw = await createCompFull({
        type: 'switch',
        name: 'cross-sw',
        floorId: fb.id,
      });
      const l = await createCompFull({
        type: 'light',
        name: 'cross-light',
        floorId: fa.id,
      });
      await app.request(`/api/v1/components/${sw.id}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gangIndex: 0, controlledId: l.id }),
      });
      const r = await app.request(
        `/api/v1/switch-controls?floorId=${fa.id}`
      );
      const body = (await r.json()) as { data: SwitchControl[] };
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].switchId, sw.id);
      assert.equal(body.data[0].controlledId, l.id);
    });

    it('rejects missing floorId with 400', async () => {
      const r = await app.request('/api/v1/switch-controls');
      assert.equal(r.status, 400);
    });
  });
});
