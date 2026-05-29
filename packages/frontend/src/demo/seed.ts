/**
 * Demo sample data — POSTed through the real in-browser app so it exercises
 * the actual routes + zod validation + repositories (no direct DB writes).
 *
 * This mirrors the fixture SHAPE of `packages/frontend/e2e/seed.ts` (a panel
 * with a mix of breakers, a floor with rooms/walls, components incl. a 2-gang
 * switch wired to two lights). It is fixture *data*, not product logic — the
 * only thing intentionally duplicated. No auth: the demo app is built with
 * `auth: null`, so requests carry no cookie.
 */
import type { Hono } from 'hono';

type Json = Record<string, unknown>;

export const seedDemo = async (app: Hono): Promise<void> => {
  const post = async <T = { id: string }>(path: string, body: Json): Promise<T> => {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[demo seed] POST ${path} → ${res.status}: ${text}`);
    }
    return ((await res.json()) as { data: T }).data;
  };

  // 1) Panel
  const panel = await post('/api/v1/panels', {
    name: 'Main Panel',
    orientation: 'vertical',
    slotCount: 24,
  });

  // 2) Breakers — single/double-pole + a couple with protection, plus loads
  const breakerSpecs: Json[] = [
    { slot: '1', slotPosition: 1, amperage: 15, poles: 'single', label: 'Kitchen lights' },
    { slot: '2', slotPosition: 2, amperage: 20, poles: 'single', label: 'Kitchen outlets', protection: 'gfci' },
    { slot: '3', slotPosition: 3, amperage: 30, poles: 'double', label: 'Range' },
    { slot: '5', slotPosition: 5, amperage: 15, poles: 'single', label: 'Living room' },
    { slot: '6', slotPosition: 6, amperage: 15, poles: 'single', label: 'Bedroom', protection: 'afci' },
    { slot: '7', slotPosition: 7, amperage: 20, poles: 'single', label: 'Bathroom GFCI', protection: 'gfci' },
  ];
  const breakerIds: string[] = [];
  for (const spec of breakerSpecs) {
    const b = await post(`/api/v1/panels/${panel.id}/breakers`, spec);
    breakerIds.push(b.id);
  }

  // 3) Floor
  const floor = await post('/api/v1/floors', { name: 'Main Floor', displayOrder: 1 });

  // 4) Rooms — two axis-aligned rectangles
  for (const spec of [
    { name: 'Kitchen', x: 500, y: 500, w: 3500, h: 3000 },
    { name: 'Living Room', x: 4500, y: 500, w: 4500, h: 4500 },
  ] satisfies Json[]) {
    await post(`/api/v1/floors/${floor.id}/rooms`, spec);
  }

  // 5) Walls
  for (const spec of [
    { x1: 500, y1: 500, x2: 4000, y2: 500 },
    { x1: 500, y1: 500, x2: 500, y2: 3500 },
    { x1: 4500, y1: 500, x2: 9000, y2: 500 },
    { x1: 9000, y1: 500, x2: 9000, y2: 5000 },
  ] satisfies Json[]) {
    await post(`/api/v1/floors/${floor.id}/walls`, spec);
  }

  // 6) Components — mix of types incl. the multi-gang switch + realistic loads
  const componentSpecs: Json[] = [
    { type: 'outlet', name: 'Kitchen Outlet 1', room: 'Kitchen', breakerId: breakerIds[1], floorId: floor.id, posX: 1500, posY: 1500, loadWatts: 180 },
    { type: 'outlet', name: 'Kitchen Outlet 2', room: 'Kitchen', breakerId: breakerIds[1], floorId: floor.id, posX: 2500, posY: 1500, loadWatts: 1500 },
    { type: 'light', name: 'Kitchen Ceiling Light', room: 'Kitchen', breakerId: breakerIds[0], floorId: floor.id, posX: 2000, posY: 2500, loadWatts: 60 },
    { type: 'light', name: 'Living Room Light', room: 'Living Room', breakerId: breakerIds[3], floorId: floor.id, posX: 6500, posY: 2500, loadWatts: 60 },
    { type: 'switch', name: '2-Gang Switch', room: 'Living Room', breakerId: breakerIds[3], floorId: floor.id, posX: 5000, posY: 1000, gangs: 2 },
    { type: 'appliance', name: 'Range', room: 'Kitchen', breakerId: breakerIds[2], floorId: floor.id, posX: 3000, posY: 2000, loadWatts: 5000, critical: true },
    { type: 'smoke_detector', name: 'Hallway Smoke', room: 'Living Room', breakerId: breakerIds[4], floorId: floor.id, posX: 7500, posY: 3500, critical: true },
    { type: 'junction_box', name: 'Ceiling Junction', room: 'Living Room', breakerId: null, floorId: floor.id, posX: 8000, posY: 1500 },
  ];
  const componentIds: string[] = [];
  for (const spec of componentSpecs) {
    const c = await post('/api/v1/components', spec);
    componentIds.push(c.id);
  }

  // 7) Switch controls — gang 0 → kitchen light, gang 1 → living-room light
  const switchId = componentIds[4];
  await post(`/api/v1/components/${switchId}/controls`, { gangIndex: 0, controlledId: componentIds[2] });
  await post(`/api/v1/components/${switchId}/controls`, { gangIndex: 1, controlledId: componentIds[3] });
};
