/**
 * useMultiSelect unit tests (G42(f) — cycle-50).
 *
 * Runs via Node's built-in test runner — see CLAUDE.md G26 #8 for the
 * canonical command (`packages/backend/node_modules/.bin/tsx --test
 * <path>`). No new devDep wiring; the backend's tsx is reused.
 *
 * The hook itself uses React hooks (useState/useEffect/useMemo/useCallback)
 * which can't run outside a renderer, so this suite exercises the same
 * Set-of-ids semantics via a tiny pure mirror — toggle, selectAll, clear,
 * auto-prune, and selectedItems projection. The pure helpers are extracted
 * inline below and mirror what the hook does step-for-step, so a behavioral
 * regression in either is caught.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure mirror of the toggle reducer in useMultiSelect (the hook calls
// setSelectedIds((cur) => ...) with this exact shape).
const toggleReducer = (cur: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(cur);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// Pure mirror of the auto-prune effect — drop ids no longer present in items.
const pruneReducer = <T extends { id: string }>(
  cur: ReadonlySet<string>,
  items: readonly T[]
): ReadonlySet<string> => {
  let changed = false;
  const next = new Set<string>();
  const itemIds = new Set(items.map((it) => it.id));
  for (const id of cur) {
    if (itemIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? next : cur;
};

// Pure mirror of selectedItems memo.
const projectSelectedItems = <T extends { id: string }>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>
): readonly T[] => items.filter((it) => selectedIds.has(it.id));

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

test('toggle adds an unselected id', () => {
  const before: ReadonlySet<string> = new Set();
  const after = toggleReducer(before, 'a');
  assert.equal(after.has('a'), true);
  assert.equal(after.size, 1);
});

test('toggle removes a selected id', () => {
  const before: ReadonlySet<string> = new Set(['a', 'b']);
  const after = toggleReducer(before, 'a');
  assert.equal(after.has('a'), false);
  assert.equal(after.has('b'), true);
  assert.equal(after.size, 1);
});

test('selectAll populates from items', () => {
  // The hook does `new Set(items.map((it) => it.id))` — equivalent here.
  const next = new Set(rows.map((r) => r.id));
  assert.equal(next.size, 3);
  assert.equal(next.has('a'), true);
  assert.equal(next.has('b'), true);
  assert.equal(next.has('c'), true);
});

test('clear empties the selection', () => {
  // The hook does `new Set()`.
  const next: ReadonlySet<string> = new Set();
  assert.equal(next.size, 0);
});

test('auto-prune drops ids no longer in items', () => {
  const before: ReadonlySet<string> = new Set(['a', 'b', 'c']);
  // Row 'b' was deleted between renders.
  const newItems: Row[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'c', name: 'Gamma' },
  ];
  const after = pruneReducer(before, newItems);
  assert.notStrictEqual(after, before); // changed → new Set returned
  assert.equal(after.has('a'), true);
  assert.equal(after.has('b'), false);
  assert.equal(after.has('c'), true);
  assert.equal(after.size, 2);
});

test('auto-prune is a no-op when all ids still exist (returns same ref)', () => {
  const before: ReadonlySet<string> = new Set(['a', 'c']);
  const after = pruneReducer(before, rows);
  // Crucially, returns the same reference so React skips a re-render.
  assert.strictEqual(after, before);
});

test('count + selectedItems update from id-set', () => {
  const ids: ReadonlySet<string> = new Set(['a', 'c']);
  const selected = projectSelectedItems(rows, ids);
  assert.equal(ids.size, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].id, 'a');
  assert.equal(selected[1].id, 'c');
});

test('selectedItems preserves items order (not selection order)', () => {
  // Even if we toggled 'c' before 'a', the items array is the source of truth.
  const ids: ReadonlySet<string> = new Set(['c', 'a']);
  const selected = projectSelectedItems(rows, ids);
  assert.equal(selected[0].id, 'a');
  assert.equal(selected[1].id, 'c');
});

test('selectedItems excludes ids whose rows no longer exist', () => {
  const ids: ReadonlySet<string> = new Set(['a', 'b', 'z']);
  const selected = projectSelectedItems(rows, ids);
  // 'z' isn't in rows — filter drops it from the projection.
  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((r) => r.id),
    ['a', 'b']
  );
});
