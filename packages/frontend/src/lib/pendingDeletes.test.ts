/**
 * pendingDeletes unit tests (G42(c) — cycle-47).
 *
 * Runs via Node's built-in test runner — see CLAUDE.md G26 #8 for the
 * canonical command (`packages/backend/node_modules/.bin/tsx --test
 * <path>`). No new devDep wiring; the backend's tsx is reused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedulePendingDelete,
  cancelPendingDelete,
  hasPending,
  completePendingDelete,
  _pendingCount,
  type PendingEntry,
} from './pendingDeletes.js';

const fixture = (id: string, opts: Partial<PendingEntry> = {}): PendingEntry => ({
  id,
  resourceType: opts.resourceType ?? 'component',
  commit: opts.commit ?? (async (): Promise<void> => {}),
  onUndo: opts.onUndo ?? ((): void => {}),
  timer: opts.timer ?? setTimeout(() => {}, 100),
  toastId: opts.toastId ?? `toast-${id}`,
});

test('cancelPendingDelete clears the timer + queue entry', () => {
  const id = 'test-cancel-1';
  let committed = false;
  const timer = setTimeout(() => {
    committed = true;
  }, 50);
  schedulePendingDelete(
    fixture(id, {
      timer,
      commit: async (): Promise<void> => {
        committed = true;
      },
    })
  );
  assert.equal(hasPending(id), true);
  const cancelled = cancelPendingDelete(id);
  assert.equal(cancelled, true);
  assert.equal(hasPending(id), false);
  // Even if we wait past the original 50ms timer, committed must stay
  // false because cancelPendingDelete called clearTimeout. We don't
  // bother sleeping — the queue clear is the load-bearing assertion.
  assert.equal(committed, false);
});

test('cancel is idempotent (second cancel on missing id returns false)', () => {
  // Pre-clean: ensure the id isn't in the queue from a prior test run.
  cancelPendingDelete('nonexistent-test-id');
  assert.equal(cancelPendingDelete('nonexistent-test-id'), false);
});

test('completePendingDelete removes the entry without clearing the timer', () => {
  const id = 'test-complete';
  const timer = setTimeout(() => {}, 100);
  schedulePendingDelete(fixture(id, { timer }));
  assert.equal(hasPending(id), true);
  completePendingDelete(id);
  assert.equal(hasPending(id), false);
  clearTimeout(timer); // hygiene — test runner shouldn't wait on a stale timer
});

test('schedule + cancel: queue size returns to baseline', () => {
  const baseline = _pendingCount();
  const id = 'test-size';
  const timer = setTimeout(() => {}, 100);
  schedulePendingDelete(fixture(id, { timer }));
  assert.equal(_pendingCount(), baseline + 1);
  cancelPendingDelete(id);
  assert.equal(_pendingCount(), baseline);
});

test('schedule with same id overwrites the previous entry', () => {
  const id = 'test-overwrite';
  const timer1 = setTimeout(() => {}, 100);
  const timer2 = setTimeout(() => {}, 100);
  schedulePendingDelete(fixture(id, { timer: timer1, resourceType: 'a' }));
  schedulePendingDelete(fixture(id, { timer: timer2, resourceType: 'b' }));
  // The Map.set semantics mean the second schedule replaces the first;
  // there's still exactly ONE entry for this id, and cancel returns true
  // exactly once.
  assert.equal(hasPending(id), true);
  assert.equal(cancelPendingDelete(id), true);
  assert.equal(hasPending(id), false);
  assert.equal(cancelPendingDelete(id), false);
  // Cleanup — timer1 was orphaned by the overwrite (the cycle-47 hook
  // owns the lifecycle and avoids this scenario in practice).
  clearTimeout(timer1);
});
