/**
 * suffixDuplicate unit tests (G42(a) — cycle-49).
 *
 * Runs via Node's built-in test runner — see CLAUDE.md G26 #8 for the
 * canonical command (`packages/backend/node_modules/.bin/tsx --test
 * <path>`). No new devDep wiring; the backend's tsx is reused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suffixDuplicate } from './duplicateName.js';

test('suffixDuplicate appends " (2)" to a plain name', () => {
  assert.equal(suffixDuplicate('Foo'), 'Foo (2)');
});

test('suffixDuplicate bumps " (2)" to " (3)"', () => {
  assert.equal(suffixDuplicate('Foo (2)'), 'Foo (3)');
});

test('suffixDuplicate bumps " (10)" to " (11)" (handles multi-digit counters)', () => {
  assert.equal(suffixDuplicate('Foo (10)'), 'Foo (11)');
});

test('suffixDuplicate on empty string returns " (2)" (edge case — documented behavior)', () => {
  assert.equal(suffixDuplicate(''), ' (2)');
});

test('suffixDuplicate treats non-numeric parenthetical suffix as part of base name', () => {
  // "Foo (bar)" does NOT match the /^(.*) \((\d+)\)$/ regex, so the entire
  // string is the "base" and " (2)" gets appended.
  assert.equal(suffixDuplicate('Foo (bar)'), 'Foo (bar) (2)');
});

test('suffixDuplicate bumps multi-word base names', () => {
  assert.equal(suffixDuplicate('Main Floor (2)'), 'Main Floor (3)');
});

test('suffixDuplicate does NOT treat a leading paren as a counter', () => {
  // "(2) Foo" doesn't end in " (N)" so it gets " (2)" appended.
  assert.equal(suffixDuplicate('(2) Foo'), '(2) Foo (2)');
});
