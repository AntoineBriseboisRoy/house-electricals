import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgBreakerRepository, PgPanelRepository } from './repository.js';
import { createTestDb } from './test-helpers.js';

describe('PgBreakerRepository', () => {
  let cleanup: () => Promise<void>;
  let panelRepo: PgPanelRepository;
  let breakerRepo: PgBreakerRepository;
  let panelId: string;

  beforeEach(async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    panelRepo = new PgPanelRepository(t.db);
    breakerRepo = new PgBreakerRepository(t.db);
    const p = await panelRepo.create({ name: 'Main' });
    panelId = p.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('listByPanel returns empty initially', async () => {
    assert.deepEqual(await breakerRepo.listByPanel(panelId), []);
  });

  it('creates a breaker and returns the row', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '15',
      amperage: 20,
      poles: 'single',
      label: 'Kitchen counter',
    });
    assert.equal(b.panelId, panelId);
    assert.equal(b.slot, '15');
    assert.equal(b.amperage, 20);
    assert.equal(b.poles, 'single');
    assert.equal(b.label, 'Kitchen counter');
    assert.equal(b.slotPosition, null);
    assert.match(b.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts listByPanel by slot_position ASC NULLS LAST then slot ASC', async () => {
    await breakerRepo.create(panelId, { slot: 'A', amperage: 20, poles: 'single', label: '' });
    await breakerRepo.create(panelId, {
      slot: 'B',
      amperage: 20,
      poles: 'single',
      label: '',
      slotPosition: 5,
    });
    await breakerRepo.create(panelId, {
      slot: 'C',
      amperage: 20,
      poles: 'single',
      label: '',
      slotPosition: 1,
    });
    await breakerRepo.create(panelId, {
      slot: 'D',
      amperage: 20,
      poles: 'single',
      label: '',
      slotPosition: 3,
    });

    const all = await breakerRepo.listByPanel(panelId);
    // Expected order: slot_position 1 (C), 3 (D), 5 (B), then NULL (A).
    assert.deepEqual(
      all.map((b) => b.slot),
      ['C', 'D', 'B', 'A']
    );
  });

  it('get returns the breaker or null', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '1',
      amperage: 30,
      poles: 'double',
      label: 'Dryer',
    });
    const fetched = await breakerRepo.get(b.id);
    assert.deepEqual(fetched, b);
    assert.equal(await breakerRepo.get('nonexistent'), null);
  });

  it('update applies partial patch and returns updated, or null for missing', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '7',
      amperage: 20,
      poles: 'single',
      label: 'Living room',
    });
    const updated = await breakerRepo.update(b.id, { amperage: 30, poles: 'double' });
    assert.equal(updated?.amperage, 30);
    assert.equal(updated?.poles, 'double');
    assert.equal(updated?.slot, '7');
    assert.equal(updated?.label, 'Living room');

    assert.equal(await breakerRepo.update('nonexistent', { amperage: 1 }), null);
  });

  it('update can set slotPosition to a value or back to null', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '7',
      amperage: 20,
      poles: 'single',
      label: 'Living room',
      slotPosition: 4,
    });
    const cleared = await breakerRepo.update(b.id, { slotPosition: null });
    assert.equal(cleared?.slotPosition, null);

    const reset = await breakerRepo.update(b.id, { slotPosition: 9 });
    assert.equal(reset?.slotPosition, 9);
  });

  it('delete returns true on hit, false on miss', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: 'X',
      amperage: 20,
      poles: 'single',
      label: '',
    });
    assert.equal(await breakerRepo.delete(b.id), true);
    assert.equal(await breakerRepo.get(b.id), null);
    assert.equal(await breakerRepo.delete('nonexistent'), false);
  });

  it('deleteByPanel removes all breakers for that panel and leaves others alone', async () => {
    const other = await panelRepo.create({ name: 'Garage' });
    await breakerRepo.create(panelId, { slot: '1', amperage: 20, poles: 'single', label: '' });
    await breakerRepo.create(panelId, { slot: '2', amperage: 20, poles: 'single', label: '' });
    await breakerRepo.create(other.id, { slot: '1', amperage: 30, poles: 'double', label: 'Dryer' });

    await breakerRepo.deleteByPanel(panelId);
    assert.deepEqual(await breakerRepo.listByPanel(panelId), []);
    assert.equal((await breakerRepo.listByPanel(other.id)).length, 1);
  });

  it('G37 cycle-68 — protection defaults to null on create', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'Default-protection',
    });
    assert.equal(b.protection, null);
    const fetched = await breakerRepo.get(b.id);
    assert.equal(fetched?.protection, null);
  });

  it('G37 cycle-68 — create with protection=gfci persists', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '3',
      amperage: 20,
      poles: 'single',
      label: 'Bathroom',
      protection: 'gfci',
    });
    assert.equal(b.protection, 'gfci');
    const fetched = await breakerRepo.get(b.id);
    assert.equal(fetched?.protection, 'gfci');
  });

  it('G37 cycle-68 — create with protection=afci and dual persists', async () => {
    const a = await breakerRepo.create(panelId, {
      slot: '5',
      amperage: 15,
      poles: 'single',
      label: 'Bedroom',
      protection: 'afci',
    });
    assert.equal(a.protection, 'afci');
    const d = await breakerRepo.create(panelId, {
      slot: '7',
      amperage: 20,
      poles: 'single',
      label: 'Kitchen',
      protection: 'dual',
    });
    assert.equal(d.protection, 'dual');
  });

  it('G37 cycle-68 — update toggles protection', async () => {
    const b = await breakerRepo.create(panelId, {
      slot: '9',
      amperage: 20,
      poles: 'single',
      label: 'Outdoor',
      protection: 'gfci',
    });
    assert.equal(b.protection, 'gfci');
    const a = await breakerRepo.update(b.id, { protection: 'afci' });
    assert.equal(a?.protection, 'afci');
    const cleared = await breakerRepo.update(b.id, { protection: null });
    assert.equal(cleared?.protection, null);
  });

  it('G37 cycle-68 — listByPanel includes protection in response', async () => {
    await breakerRepo.create(panelId, {
      slot: '11',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });
    await breakerRepo.create(panelId, {
      slot: '13',
      amperage: 20,
      poles: 'single',
      label: 'B',
      protection: 'gfci',
    });
    const list = await breakerRepo.listByPanel(panelId);
    const byLabel = new Map(list.map((b) => [b.label, b]));
    assert.equal(byLabel.get('A')?.protection, null);
    assert.equal(byLabel.get('B')?.protection, 'gfci');
  });
});
