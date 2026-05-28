import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
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
import { sniffImage } from './image-meta.js';

// Minimal 2x3 PNG (Red 2x3 image) for tests.
const tinyPng = (): Uint8Array =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // sig
    0x00, 0x00, 0x00, 0x0d, // IHDR length 13
    0x49, 0x48, 0x44, 0x52, // 'IHDR'
    0x00, 0x00, 0x00, 0x02, // width 2
    0x00, 0x00, 0x00, 0x03, // height 3
    0x08, 0x02, 0x00, 0x00, 0x00, // bit-depth 8, color RGB, etc
    0x12, 0x16, 0xf1, 0x4d, // CRC (not validated by sniffer)
    0x00, 0x00, 0x00, 0x14, // IDAT length 20
    0x49, 0x44, 0x41, 0x54, // 'IDAT'
    0x78, 0x9c, 0x62, 0xfc, 0xcf, 0xc0, 0xc0, 0xc0, 0xc0, 0xc4, 0xc0, 0x00,
    0x00, 0x00, 0x10, 0x00, 0x01, 0x53, 0x9b, 0x99,
    0x00, 0x00, 0x00, 0x00, // IEND length 0
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);

describe('sniffImage', () => {
  it('detects PNG width/height', () => {
    const meta = sniffImage(tinyPng());
    assert.notEqual(meta, null);
    assert.equal(meta?.mime, 'image/png');
    assert.equal(meta?.width, 2);
    assert.equal(meta?.height, 3);
  });

  it('rejects an unknown signature', () => {
    const meta = sniffImage(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    assert.equal(meta, null);
  });

  it('rejects SVG (xml signature is not in the whitelist)', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg></svg>');
    assert.equal(sniffImage(svg), null);
  });
});

describe('floor-plan routes (now scoped to floors, G13)', () => {
  let dir: string;
  let dataDir: string;
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  let floorId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-fp-'));
    dataDir = join(dir, 'floor-plans');
    process.env.FLOOR_PLAN_DIR = dataDir;
    db = openDatabase(join(dir, 'test.db'));
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
    const r = await app.request('/api/v1/floors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main' }),
    });
    floorId = ((await r.json()) as { data: { id: string } }).data.id;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FLOOR_PLAN_DIR;
  });

  it('rejects upload to a missing floor with 404', async () => {
    const form = new FormData();
    form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'a.png');
    const res = await app.request('/api/v1/floors/nonexistent/floor-plan', {
      method: 'POST',
      body: form,
    });
    assert.equal(res.status, 404);
  });

  it('rejects a bogus content with 400', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'a.png');
    const res = await app.request(`/api/v1/floors/${floorId}/floor-plan`, {
      method: 'POST',
      body: form,
    });
    assert.equal(res.status, 400);
  });

  it('accepts a valid PNG, persists path + width + height, file lands in the dir', async () => {
    const form = new FormData();
    form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'plan.png');
    const res = await app.request(`/api/v1/floors/${floorId}/floor-plan`, {
      method: 'POST',
      body: form,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: { floorPlan: { filename: string; width: number; height: number } | null };
    };
    assert.ok(body.data.floorPlan);
    assert.equal(body.data.floorPlan!.width, 2);
    assert.equal(body.data.floorPlan!.height, 3);
    assert.ok(body.data.floorPlan!.filename.endsWith('.png'));
    assert.ok(body.data.floorPlan!.filename.startsWith(`${floorId}-`));

    // File written to disk.
    const written = readFileSync(join(dataDir, body.data.floorPlan!.filename));
    assert.equal(written.length, tinyPng().length);
  });

  it('replace: a second upload of identical bytes yields the same filename', async () => {
    const form1 = new FormData();
    form1.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'a.png');
    const r1 = await app.request(`/api/v1/floors/${floorId}/floor-plan`, {
      method: 'POST',
      body: form1,
    });
    const first = ((await r1.json()) as { data: { floorPlan: { filename: string } } }).data
      .floorPlan;

    const form2 = new FormData();
    form2.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'b.png');
    const r2 = await app.request(`/api/v1/floors/${floorId}/floor-plan`, {
      method: 'POST',
      body: form2,
    });
    assert.equal(r2.status, 200);
    const second = ((await r2.json()) as { data: { floorPlan: { filename: string } } }).data
      .floorPlan;
    assert.equal(second.filename, first.filename);
  });

  it('DELETE removes the row info and the file', async () => {
    const form = new FormData();
    form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'a.png');
    const r1 = await app.request(`/api/v1/floors/${floorId}/floor-plan`, {
      method: 'POST',
      body: form,
    });
    const filename = ((await r1.json()) as { data: { floorPlan: { filename: string } } }).data
      .floorPlan.filename;
    assert.ok(statSync(join(dataDir, filename)).isFile());

    const r2 = await app.request(`/api/v1/floors/${floorId}/floor-plan`, { method: 'DELETE' });
    assert.equal(r2.status, 200);
    const body = (await r2.json()) as { data: { floorPlan: null } };
    assert.equal(body.data.floorPlan, null);

    let stillExists = true;
    try {
      statSync(join(dataDir, filename));
    } catch {
      stillExists = false;
    }
    assert.equal(stillExists, false);
  });

  it('DELETE on a floor with no plan returns 404', async () => {
    const r = await app.request(`/api/v1/floors/${floorId}/floor-plan`, { method: 'DELETE' });
    assert.equal(r.status, 404);
  });
});
