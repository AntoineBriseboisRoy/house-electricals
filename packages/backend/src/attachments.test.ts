import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { Attachment, Component } from '@he/shared';
import type { Db } from './db.js';
import { buildTestApp, createTestDb } from './test-helpers.js';

// Minimal valid 2x3 PNG (sniffImage reads width @16, height @20).
const tinyPng = (): Uint8Array =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x12, 0x16, 0xf1, 0x4d,
    0x00, 0x00, 0x00, 0x14, 0x49, 0x44, 0x41, 0x54,
    0x78, 0x9c, 0x62, 0xfc, 0xcf, 0xc0, 0xc0, 0xc0, 0xc0, 0xc4, 0xc0, 0x00,
    0x00, 0x00, 0x10, 0x00, 0x01, 0x53, 0x9b, 0x99,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);

describe('attachment (photo) routes (2026-05)', () => {
  let dir: string;
  let photoDir: string;
  let cleanup: () => Promise<void>;
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'he-att-'));
    photoDir = join(dir, 'floor-plans');
    process.env.FLOOR_PLAN_DIR = photoDir;
    const t = await createTestDb();
    cleanup = t.cleanup;
    db = t.db;
    app = buildTestApp(t.db);
  });

  afterEach(async () => {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FLOOR_PLAN_DIR;
  });

  const createComponent = async (name: string): Promise<Component> => {
    const r = await app.request('/api/v1/components', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'outlet', name }),
    });
    return ((await r.json()) as { data: Component }).data;
  };

  const createBreaker = async (): Promise<string> => {
    const pr = await app.request('/api/v1/panels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `P-${Math.random().toString(36).slice(2, 7)}` }),
    });
    const panelId = ((await pr.json()) as { data: { id: string } }).data.id;
    const br = await app.request(`/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: '1',
        slotPosition: 1,
        amperage: 20,
        poles: 'single',
        label: 'L1',
      }),
    });
    return ((await br.json()) as { data: { id: string } }).data.id;
  };

  const uploadPhoto = async (
    path: string,
    bytes: Uint8Array = tinyPng()
  ): Promise<Response> => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'p.png');
    return app.request(path, { method: 'POST', body: form });
  };

  it('uploads a photo to a component, persists the row + file', async () => {
    const c = await createComponent('Kitchen outlet');
    const res = await uploadPhoto(`/api/v1/components/${c.id}/photos`);
    assert.equal(res.status, 201);
    const att = ((await res.json()) as { data: Attachment }).data;
    assert.equal(att.parentType, 'component');
    assert.equal(att.parentId, c.id);
    assert.ok(att.filename.endsWith('.png'));
    assert.ok(att.filename.startsWith('photo-'));
    // File lands on disk under FLOOR_PLAN_DIR.
    assert.ok(existsSync(join(photoDir, att.filename)));
  });

  it('lists photos for a component (creation order)', async () => {
    const c = await createComponent('C');
    await uploadPhoto(`/api/v1/components/${c.id}/photos`);
    await uploadPhoto(`/api/v1/components/${c.id}/photos`);
    const r = await app.request(`/api/v1/components/${c.id}/photos`);
    assert.equal(r.status, 200);
    const list = ((await r.json()) as { data: Attachment[] }).data;
    assert.equal(list.length, 2);
    assert.ok(list.every((a) => a.parentType === 'component' && a.parentId === c.id));
  });

  it('uploads + lists photos for a breaker', async () => {
    const breakerId = await createBreaker();
    const res = await uploadPhoto(`/api/v1/breakers/${breakerId}/photos`);
    assert.equal(res.status, 201);
    const list = ((await (
      await app.request(`/api/v1/breakers/${breakerId}/photos`)
    ).json()) as { data: Attachment[] }).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].parentType, 'breaker');
    assert.equal(list[0].parentId, breakerId);
  });

  it('rejects upload to a missing component with 404', async () => {
    const res = await uploadPhoto('/api/v1/components/nope/photos');
    assert.equal(res.status, 404);
  });

  it('rejects a non-image (bogus bytes) with 400', async () => {
    const c = await createComponent('C');
    const res = await uploadPhoto(
      `/api/v1/components/${c.id}/photos`,
      new Uint8Array([1, 2, 3, 4])
    );
    assert.equal(res.status, 400);
  });

  it('DELETE removes the row AND the file', async () => {
    const c = await createComponent('C');
    const att = ((await (
      await uploadPhoto(`/api/v1/components/${c.id}/photos`)
    ).json()) as { data: Attachment }).data;
    const filePath = join(photoDir, att.filename);
    assert.ok(existsSync(filePath));

    const del = await app.request(`/api/v1/photos/${att.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.ok(!existsSync(filePath));
    const list = ((await (
      await app.request(`/api/v1/components/${c.id}/photos`)
    ).json()) as { data: Attachment[] }).data;
    assert.equal(list.length, 0);
  });

  it('DELETE on a missing photo returns 404', async () => {
    const del = await app.request('/api/v1/photos/nope', { method: 'DELETE' });
    assert.equal(del.status, 404);
  });

  it('cascade: deleting the component removes its attachment rows', async () => {
    const c = await createComponent('C');
    await uploadPhoto(`/api/v1/components/${c.id}/photos`);
    await app.request(`/api/v1/components/${c.id}`, { method: 'DELETE' });
    const row = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM attachments WHERE parent_type = 'component' AND parent_id = $1`,
      [c.id]
    );
    assert.equal(Number(row?.n), 0);
  });

  it('cascade: deleting the breaker removes its attachment rows', async () => {
    const breakerId = await createBreaker();
    await uploadPhoto(`/api/v1/breakers/${breakerId}/photos`);
    await app.request(`/api/v1/breakers/${breakerId}`, { method: 'DELETE' });
    const row = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM attachments WHERE parent_type = 'breaker' AND parent_id = $1`,
      [breakerId]
    );
    assert.equal(Number(row?.n), 0);
  });
});
