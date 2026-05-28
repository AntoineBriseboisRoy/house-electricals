import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  SqliteBreakerRepository,
  SqliteComponentRepository,
  SqlitePanelRepository,
  SqliteServiceEntryRepository,
} from './repository.js';

describe('SqliteComponentRepository', () => {
  let dir: string;
  let db: DatabaseSync;
  let repo: SqliteComponentRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-cmp-'));
    db = openDatabase(join(dir, 'test.db'));
    repo = new SqliteComponentRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists empty initially', async () => {
    assert.deepEqual(await repo.list(), []);
  });

  it('creates a component with null room/notes/breakerId by default', async () => {
    const c = await repo.create({ type: 'outlet', name: 'Kitchen counter' });
    assert.equal(c.type, 'outlet');
    assert.equal(c.name, 'Kitchen counter');
    assert.equal(c.room, null);
    assert.equal(c.notes, null);
    assert.equal(c.breakerId, null);
    assert.match(c.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('persists room and notes when provided', async () => {
    const c = await repo.create({
      type: 'light',
      name: 'Hallway ceiling',
      room: 'Hallway',
      notes: 'Dimmable',
    });
    assert.equal(c.room, 'Hallway');
    assert.equal(c.notes, 'Dimmable');
  });

  it('get returns the resolved component (unassigned -> breaker: null) or null', async () => {
    const c = await repo.create({ type: 'switch', name: 'Bedroom switch' });
    assert.deepEqual(await repo.get(c.id), { ...c, breaker: null });
    assert.equal(await repo.get('nonexistent'), null);
  });

  it('update applies partial patch and returns updated', async () => {
    const c = await repo.create({
      type: 'outlet',
      name: 'Old name',
      room: 'Living',
    });
    const updated = await repo.update(c.id, { name: 'New name', room: 'Kitchen' });
    assert.equal(updated?.name, 'New name');
    assert.equal(updated?.room, 'Kitchen');
    assert.equal(updated?.type, 'outlet');

    assert.equal(await repo.update('nonexistent', { name: 'x' }), null);
  });

  it('update can clear room or notes by patching with null', async () => {
    const c = await repo.create({
      type: 'light',
      name: 'X',
      room: 'Foyer',
      notes: 'note',
    });
    const cleared = await repo.update(c.id, { room: null, notes: null });
    assert.equal(cleared?.room, null);
    assert.equal(cleared?.notes, null);
  });

  it('delete returns true on hit, false on miss', async () => {
    const c = await repo.create({ type: 'other', name: 'X' });
    assert.equal(await repo.delete(c.id), true);
    assert.equal(await repo.get(c.id), null);
    assert.equal(await repo.delete('nonexistent'), false);
  });

  it('list filter by room is exact and case-sensitive', async () => {
    await repo.create({ type: 'outlet', name: 'a', room: 'Kitchen' });
    await repo.create({ type: 'outlet', name: 'b', room: 'kitchen' });
    await repo.create({ type: 'outlet', name: 'c', room: 'Bedroom' });

    const exact = await repo.list({ room: 'Kitchen' });
    assert.deepEqual(
      exact.map((c) => c.name),
      ['a']
    );

    const lower = await repo.list({ room: 'kitchen' });
    assert.deepEqual(
      lower.map((c) => c.name),
      ['b']
    );

    const missing = await repo.list({ room: 'Garage' });
    assert.deepEqual(missing, []);
  });

  it('list filter by type returns only that type', async () => {
    await repo.create({ type: 'outlet', name: 'a' });
    await repo.create({ type: 'light', name: 'b' });
    await repo.create({ type: 'outlet', name: 'c' });

    const outlets = await repo.list({ type: 'outlet' });
    assert.deepEqual(
      outlets.map((c) => c.name),
      ['a', 'c']
    );

    const lights = await repo.list({ type: 'light' });
    assert.deepEqual(
      lights.map((c) => c.name),
      ['b']
    );
  });

  it('list combines filters with AND', async () => {
    await repo.create({ type: 'outlet', name: 'a', room: 'Kitchen' });
    await repo.create({ type: 'light', name: 'b', room: 'Kitchen' });
    await repo.create({ type: 'outlet', name: 'c', room: 'Bedroom' });

    const result = await repo.list({ room: 'Kitchen', type: 'outlet' });
    assert.deepEqual(
      result.map((c) => c.name),
      ['a']
    );
  });
});

describe('component <-> breaker mapping cascade', () => {
  let dir: string;
  let db: DatabaseSync;
  let panelRepo: SqlitePanelRepository;
  let breakerRepo: SqliteBreakerRepository;
  let componentRepo: SqliteComponentRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-map-'));
    db = openDatabase(join(dir, 'test.db'));
    panelRepo = new SqlitePanelRepository(db);
    breakerRepo = new SqliteBreakerRepository(db);
    componentRepo = new SqliteComponentRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('create accepts a breakerId pointing at a valid breaker', async () => {
    const panel = await panelRepo.create({ name: 'Main' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'Kitchen',
    });

    const component = await componentRepo.create({
      type: 'outlet',
      name: 'Counter',
      breakerId: breaker.id,
    });
    assert.equal(component.breakerId, breaker.id);
  });

  it('update can reassign or unassign breakerId', async () => {
    const panel = await panelRepo.create({ name: 'M' });
    const b1 = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });
    const b2 = await breakerRepo.create(panel.id, {
      slot: '2',
      amperage: 20,
      poles: 'single',
      label: 'B',
    });

    const component = await componentRepo.create({
      type: 'outlet',
      name: 'X',
      breakerId: b1.id,
    });
    assert.equal(component.breakerId, b1.id);

    const reassigned = await componentRepo.update(component.id, { breakerId: b2.id });
    assert.equal(reassigned?.breakerId, b2.id);

    const unassigned = await componentRepo.update(component.id, { breakerId: null });
    assert.equal(unassigned?.breakerId, null);
  });

  it('SqliteBreakerRepository.delete nulls components.breaker_id transactionally', async () => {
    const panel = await panelRepo.create({ name: 'M' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });

    const c1 = await componentRepo.create({
      type: 'outlet',
      name: 'C1',
      breakerId: breaker.id,
    });
    const c2 = await componentRepo.create({
      type: 'light',
      name: 'C2',
      breakerId: breaker.id,
    });

    assert.equal(await breakerRepo.delete(breaker.id), true);
    assert.equal((await componentRepo.get(c1.id))?.breakerId, null);
    assert.equal((await componentRepo.get(c2.id))?.breakerId, null);
  });

  it('SqlitePanelRepository.delete cascades through breakers nulling component refs', async () => {
    const panel = await panelRepo.create({ name: 'M' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });

    const component = await componentRepo.create({
      type: 'outlet',
      name: 'X',
      breakerId: breaker.id,
    });

    assert.equal(await panelRepo.delete(panel.id), true);
    const after = await componentRepo.get(component.id);
    assert.equal(after?.breakerId, null);
  });

  it('FK enforcement: creating a component with a bogus breakerId rejects', async () => {
    await assert.rejects(
      componentRepo.create({ type: 'outlet', name: 'X', breakerId: 'bogus-id-not-real' })
    );
  });

  it('list returns ResolvedComponent with breaker info inline (panelName + slot)', async () => {
    const panel = await panelRepo.create({ name: 'Main' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '14',
      amperage: 20,
      poles: 'single',
      label: 'Kitchen',
    });
    await componentRepo.create({
      type: 'outlet',
      name: 'Counter',
      breakerId: breaker.id,
    });

    const list = await componentRepo.list();
    assert.equal(list.length, 1);
    const resolved = list[0]!;
    assert.equal(resolved.breaker?.id, breaker.id);
    assert.equal(resolved.breaker?.panelName, 'Main');
    assert.equal(resolved.breaker?.slot, '14');
    assert.equal(resolved.breaker?.amperage, 20);
    assert.equal(resolved.breaker?.poles, 'single');
  });

  it('list with search filters case-insensitively on name', async () => {
    await componentRepo.create({ type: 'outlet', name: 'Kitchen counter' });
    await componentRepo.create({ type: 'light', name: 'Living room overhead' });
    await componentRepo.create({ type: 'outlet', name: 'Bedroom plug' });

    const lower = await componentRepo.list({ search: 'KITCHEN' });
    assert.deepEqual(
      lower.map((c) => c.name),
      ['Kitchen counter']
    );

    const partial = await componentRepo.list({ search: 'oOm' });
    assert.deepEqual(
      partial.map((c) => c.name),
      ['Living room overhead', 'Bedroom plug']
    );
  });

  it('list with search also matches the room field case-insensitively', async () => {
    await componentRepo.create({ type: 'outlet', name: 'A', room: 'Hallway' });
    await componentRepo.create({ type: 'outlet', name: 'B', room: 'kitchen' });
    await componentRepo.create({ type: 'outlet', name: 'C', room: 'Bedroom' });

    const results = await componentRepo.list({ search: 'KITCH' });
    assert.deepEqual(
      results.map((c) => c.name),
      ['B']
    );
  });

  it('search AND-combines with type filter', async () => {
    await componentRepo.create({ type: 'outlet', name: 'Kitchen outlet' });
    await componentRepo.create({ type: 'light', name: 'Kitchen light' });

    const filtered = await componentRepo.list({ search: 'kitchen', type: 'outlet' });
    assert.deepEqual(
      filtered.map((c) => c.name),
      ['Kitchen outlet']
    );
  });

  it('G35 Part 2 cycle-59 — critical defaults to false on create', async () => {
    const panel = await panelRepo.create({ name: 'M' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });
    const c = await componentRepo.create({
      type: 'outlet',
      name: 'Default-critical',
      breakerId: breaker.id,
    });
    assert.equal(c.critical, false);
    const fetched = await componentRepo.get(c.id);
    assert.equal(fetched?.critical, false);
  });

  it('G35 Part 2 cycle-59 — create with critical=true persists', async () => {
    const c = await componentRepo.create({
      type: 'appliance',
      name: 'Fridge',
      critical: true,
    });
    assert.equal(c.critical, true);
    const fetched = await componentRepo.get(c.id);
    assert.equal(fetched?.critical, true);
  });

  it('G35 Part 2 cycle-59 — update toggles critical', async () => {
    const c = await componentRepo.create({
      type: 'outlet',
      name: 'Plug',
      critical: true,
    });
    assert.equal(c.critical, true);
    const off = await componentRepo.update(c.id, { critical: false });
    assert.equal(off?.critical, false);
    const back = await componentRepo.update(c.id, { critical: true });
    assert.equal(back?.critical, true);
  });

  it('G35 Part 2 cycle-59 — list includes critical in response', async () => {
    await componentRepo.create({ type: 'outlet', name: 'A' });
    await componentRepo.create({ type: 'appliance', name: 'B', critical: true });
    const list = await componentRepo.list();
    const byName = new Map(list.map((c) => [c.name, c]));
    assert.equal(byName.get('A')?.critical, false);
    assert.equal(byName.get('B')?.critical, true);
  });

  it('list filter by breakerId returns only that breaker\'s components', async () => {
    const panel = await panelRepo.create({ name: 'M' });
    const b1 = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'A',
    });
    const b2 = await breakerRepo.create(panel.id, {
      slot: '2',
      amperage: 20,
      poles: 'single',
      label: 'B',
    });

    await componentRepo.create({ type: 'outlet', name: 'on-b1', breakerId: b1.id });
    await componentRepo.create({ type: 'outlet', name: 'on-b2', breakerId: b2.id });
    await componentRepo.create({ type: 'outlet', name: 'unassigned' });

    const onB1 = await componentRepo.list({ breakerId: b1.id });
    assert.deepEqual(
      onB1.map((c) => c.name),
      ['on-b1']
    );
  });
});

describe('G40 Part 2 (cycle-67) — search matches service_entries.note', () => {
  let dir: string;
  let db: DatabaseSync;
  let componentRepo: SqliteComponentRepository;
  let serviceEntryRepo: SqliteServiceEntryRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'he-cmp-srch-'));
    db = openDatabase(join(dir, 'test.db'));
    componentRepo = new SqliteComponentRepository(db);
    serviceEntryRepo = new SqliteServiceEntryRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds a component whose service-entry note matches the search term', async () => {
    const matching = await componentRepo.create({
      type: 'outlet',
      name: 'Garage outlet',
      room: 'Garage',
    });
    const other = await componentRepo.create({
      type: 'outlet',
      name: 'Hallway outlet',
      room: 'Hallway',
    });
    // Add a service-entry whose note has a distinctive word that is NOT
    // in any component's name or room.
    await serviceEntryRepo.create({
      parentType: 'component',
      parentId: matching.id,
      note: 'Replaced outlet — terminals were scorched',
    });
    await serviceEntryRepo.create({
      parentType: 'component',
      parentId: other.id,
      note: 'Routine GFCI test, no issues',
    });

    const results = await componentRepo.list({ search: 'scorched' });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, 'Garage outlet');

    // Case-insensitive — same term, different case.
    const caseInsensitive = await componentRepo.list({ search: 'SCORCHED' });
    assert.equal(caseInsensitive.length, 1);
    assert.equal(caseInsensitive[0]?.name, 'Garage outlet');
  });

  it('returns each matching component ONCE even when multiple log entries match', async () => {
    const c = await componentRepo.create({
      type: 'light',
      name: 'Pantry light',
      room: 'Kitchen',
    });
    // 5 service entries all containing the search term — without the EXISTS
    // subquery dedup, a naive LEFT JOIN would return 5 rows here.
    for (let i = 0; i < 5; i++) {
      await serviceEntryRepo.create({
        parentType: 'component',
        parentId: c.id,
        note: `Bulb swap #${i + 1} — replaced LED bulb`,
      });
    }

    const results = await componentRepo.list({ search: 'bulb' });
    assert.equal(
      results.length,
      1,
      'component should appear exactly once even though 5 entries match'
    );
    assert.equal(results[0]?.id, c.id);
  });

  it('breaker-parented service entries do not leak into component search', async () => {
    // Verifies the parent_type='component' filter on the EXISTS subquery.
    const panelRepo = new SqlitePanelRepository(db);
    const breakerRepo = new SqliteBreakerRepository(db);
    const panel = await panelRepo.create({ name: 'P' });
    const breaker = await breakerRepo.create(panel.id, {
      slot: '1',
      amperage: 20,
      poles: 'single',
      label: 'B',
    });
    const c = await componentRepo.create({
      type: 'outlet',
      name: 'Counter outlet',
      room: 'Kitchen',
    });
    // Note: parent is the BREAKER, not the component.
    await serviceEntryRepo.create({
      parentType: 'breaker',
      parentId: breaker.id,
      note: 'Terminal lugs retorqued — UNIQUE-BREAKER-NOTE',
    });
    // Component has no notes that match.
    const results = await componentRepo.list({ search: 'UNIQUE-BREAKER-NOTE' });
    assert.equal(
      results.length,
      0,
      'breaker-parented entries must not match the component search'
    );
    // Sanity: the component itself can still be found by name.
    const byName = await componentRepo.list({ search: 'counter' });
    assert.equal(byName.length, 1);
    assert.equal(byName[0]?.id, c.id);
  });

  it('search-by-note AND-combines with type filter', async () => {
    const outlet = await componentRepo.create({
      type: 'outlet',
      name: 'A',
      room: 'Foo',
    });
    const light = await componentRepo.create({
      type: 'light',
      name: 'B',
      room: 'Bar',
    });
    // Both get a note with the same word.
    await serviceEntryRepo.create({
      parentType: 'component',
      parentId: outlet.id,
      note: 'sparkly inspection — OK',
    });
    await serviceEntryRepo.create({
      parentType: 'component',
      parentId: light.id,
      note: 'sparkly bulb installed',
    });

    const filtered = await componentRepo.list({
      search: 'sparkly',
      type: 'outlet',
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.name, 'A');
  });

  it('G37 cycle-68 — protection defaults to null on create', async () => {
    const c = await componentRepo.create({
      type: 'outlet',
      name: 'Default-protection',
    });
    assert.equal(c.protection, null);
    const fetched = await componentRepo.get(c.id);
    assert.equal(fetched?.protection, null);
  });

  it('G37 cycle-68 — create with protection=gfci/afci/dual persists', async () => {
    const g = await componentRepo.create({
      type: 'outlet',
      name: 'GFCI receptacle',
      protection: 'gfci',
    });
    assert.equal(g.protection, 'gfci');
    const a = await componentRepo.create({
      type: 'outlet',
      name: 'AFCI receptacle',
      protection: 'afci',
    });
    assert.equal(a.protection, 'afci');
    const d = await componentRepo.create({
      type: 'outlet',
      name: 'Dual-function receptacle',
      protection: 'dual',
    });
    assert.equal(d.protection, 'dual');
    const fetched = await componentRepo.get(g.id);
    assert.equal(fetched?.protection, 'gfci');
  });

  it('G37 cycle-68 — update toggles protection', async () => {
    const c = await componentRepo.create({
      type: 'outlet',
      name: 'Plug',
      protection: 'gfci',
    });
    assert.equal(c.protection, 'gfci');
    const a = await componentRepo.update(c.id, { protection: 'afci' });
    assert.equal(a?.protection, 'afci');
    const cleared = await componentRepo.update(c.id, { protection: null });
    assert.equal(cleared?.protection, null);
  });

  it('G37 cycle-68 — list includes protection in response', async () => {
    await componentRepo.create({ type: 'outlet', name: 'A' });
    await componentRepo.create({
      type: 'outlet',
      name: 'B',
      protection: 'gfci',
    });
    const list = await componentRepo.list();
    const byName = new Map(list.map((c) => [c.name, c]));
    assert.equal(byName.get('A')?.protection, null);
    assert.equal(byName.get('B')?.protection, 'gfci');
  });
});
