import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Hono } from 'hono';
import type { Building, Floor } from '@he/shared';
import { buildingExportSchema } from '@he/shared';
import { assertInsideDir, isSafeFilename, SAFE_FILENAME_RE } from './safe-path.js';
import { PgFloorRepository } from './repository.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

/**
 * G46 security-hardening regression tests:
 *   - FIX 2: buildingExportSchema arrays are bounded (.max) — an over-cap array
 *            fails safeParse, and the import route returns 400.
 *   - FIX 3: a Content-Security-Policy header is emitted on every response.
 *   - FIX 4: the fs-path guard rejects path-traversal filenames, and the import
 *            route strips an unsafe floor_plan_filename to null.
 */

const baseExport = (buildingName: string) => ({
  format: 'house-electricals-building-export' as const,
  version: 1 as const,
  exportedAt: Date.now(),
  building: { id: 'b_old', name: buildingName, createdAt: 1 },
  floors: [] as unknown[],
  rooms: [] as unknown[],
  walls: [] as unknown[],
  panels: [] as unknown[],
  breakers: [] as unknown[],
  components: [] as unknown[],
  switchControls: [] as unknown[],
  serviceEntries: [] as unknown[],
  breakerTests: [] as unknown[],
});

// ── FIX 4: fs-path guard (pure unit — no DB) ───────────────────────────────
describe('assertInsideDir (G46 FIX 4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'he-safepath-'));

  it('accepts a plain server-style filename', () => {
    const out = assertInsideDir(dir, 'floor_abc-deadbeef.png');
    assert.notEqual(out, null);
    assert.ok(out!.startsWith(dir + sep));
  });

  it('accepts a ULID photo filename', () => {
    const out = assertInsideDir(dir, 'photo-01HXY-aa11bb22.webp');
    assert.notEqual(out, null);
  });

  for (const evil of [
    '../escape.png',
    '../../etc/passwd',
    'a/b.png',
    'a\\b.png',
    '..',
    '.',
    '.hidden',
    '',
    'foo/../../bar.png',
    'with\0null.png',
  ]) {
    it(`rejects path-traversal / unsafe filename: ${JSON.stringify(evil)}`, () => {
      assert.equal(assertInsideDir(dir, evil), null);
    });
  }

  it('rejects an absolute path', () => {
    // An absolute path either fails the separator check or resolves outside dir.
    assert.equal(assertInsideDir(dir, '/etc/passwd'), null);
  });
});

describe('isSafeFilename (G46 FIX 4)', () => {
  it('accepts safe filenames', () => {
    assert.equal(isSafeFilename('floor_abc-deadbeef.png'), true);
    assert.equal(isSafeFilename('photo-01HXY-aa11bb22.webp'), true);
  });

  it('rejects unsafe filenames', () => {
    assert.equal(isSafeFilename('../escape.png'), false);
    assert.equal(isSafeFilename('a/b.png'), false);
    assert.equal(isSafeFilename('a\\b.png'), false);
    assert.equal(isSafeFilename('.hidden'), false);
    assert.equal(isSafeFilename(''), false);
    assert.equal(isSafeFilename(null), false);
    assert.equal(isSafeFilename(123), false);
  });

  it('SAFE_FILENAME_RE only matches the whitelist', () => {
    assert.equal(SAFE_FILENAME_RE.test('ok.png'), true);
    assert.equal(SAFE_FILENAME_RE.test('not ok.png'), false);
    assert.equal(SAFE_FILENAME_RE.test('../x'), false);
  });
});

// ── FIX 2: export-envelope array caps (pure unit — no DB) ───────────────────
describe('buildingExportSchema array caps (G46 FIX 2)', () => {
  it('accepts an in-bounds (empty) payload', () => {
    const parsed = buildingExportSchema.safeParse(baseExport('In Bounds'));
    assert.equal(parsed.success, true);
  });

  it('rejects a payload whose components array exceeds the cap', () => {
    // components cap is 100000; build 100001 minimal rows. They don't need to
    // satisfy the row schema — the .max() length check fails first.
    const overCap = baseExport('Too Many');
    overCap.components = new Array(100001).fill({});
    const parsed = buildingExportSchema.safeParse(overCap);
    assert.equal(parsed.success, false);
  });

  it('rejects a payload whose floors array exceeds the cap', () => {
    const overCap = baseExport('Too Many Floors');
    overCap.floors = new Array(201).fill({});
    const parsed = buildingExportSchema.safeParse(overCap);
    assert.equal(parsed.success, false);
  });
});

// ── FIX 3 + import-route behavior (DB-backed) ──────────────────────────────
describe('security headers + import hardening (G46)', () => {
  let cleanup: () => Promise<void>;
  let app: Hono;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  // Each test points FLOOR_PLAN_DIR at a throw-away tmp dir; the import route's
  // mkdir/serve never touches the operator data dir.
  const prevFloorPlanDir = process.env.FLOOR_PLAN_DIR;

  beforeEach(async () => {
    process.env.FLOOR_PLAN_DIR = mkdtempSync(join(tmpdir(), 'he-floorplan-'));
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    if (prevFloorPlanDir === undefined) delete process.env.FLOOR_PLAN_DIR;
    else process.env.FLOOR_PLAN_DIR = prevFloorPlanDir;
    await cleanup();
  });

  it('emits a Content-Security-Policy header on /api/v1/health (FIX 3)', async () => {
    const res = await app.request('/api/v1/health');
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'expected a content-security-policy header');
    assert.ok(
      csp!.includes("default-src 'self'"),
      `CSP should lock default-src to self, got: ${csp}`
    );
    assert.ok(csp!.includes("object-src 'none'"), 'CSP should forbid objects');
    assert.ok(
      csp!.includes("frame-ancestors 'none'"),
      'CSP should forbid framing'
    );
  });

  it('rejects an over-cap import payload with 400 (FIX 2 via route)', async () => {
    const overCap = baseExport('Too Many Floors');
    overCap.floors = new Array(201).fill({});
    const res = await app.request('/api/v1/buildings/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overCap),
    });
    assert.equal(res.status, 400);
  });

  it('strips an unsafe floor_plan_filename to null on import (FIX 4)', async () => {
    const payload = {
      ...baseExport('Traversal Attempt'),
      floors: [
        {
          id: 'f_old',
          name: 'Ground',
          displayOrder: 0,
          floorPlan: {
            filename: '../../../etc/passwd',
            width: 100,
            height: 100,
          },
          panelId: null,
          createdAt: 10,
        },
      ],
    };
    const res = await app.request('/api/v1/buildings/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Building };
    const floorRepo = new PgFloorRepository(db);
    const floors: Floor[] = await floorRepo.list({ buildingId: body.data.id });
    assert.equal(floors.length, 1);
    // The malicious filename must not have survived — floorPlan is nulled out.
    assert.equal(floors[0]!.floorPlan, null);
  });

  it('preserves a safe floor_plan_filename on import (FIX 4 negative case)', async () => {
    const payload = {
      ...baseExport('Safe Filename'),
      floors: [
        {
          id: 'f_old',
          name: 'Ground',
          displayOrder: 0,
          floorPlan: {
            filename: 'f_old-deadbeef.png',
            width: 640,
            height: 480,
          },
          panelId: null,
          createdAt: 10,
        },
      ],
    };
    const res = await app.request('/api/v1/buildings/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: Building };
    const floorRepo = new PgFloorRepository(db);
    const floors: Floor[] = await floorRepo.list({ buildingId: body.data.id });
    assert.equal(floors.length, 1);
    assert.notEqual(floors[0]!.floorPlan, null);
    assert.equal(floors[0]!.floorPlan!.filename, 'f_old-deadbeef.png');
  });
});
