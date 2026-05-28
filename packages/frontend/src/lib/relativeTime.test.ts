/**
 * G36 cycle-61 — relativeTime tests. Uses node:test + assert.
 *
 * Run with: packages/backend/node_modules/.bin/tsx --test
 *   packages/frontend/src/lib/relativeTime.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative, isStaleOlderThanOneYear } from './relativeTime.js';

const NOW = 1_700_000_000_000; // fixed reference

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('formatRelative', () => {
  it('returns "just now" for <1min ago', () => {
    assert.equal(formatRelative(NOW - 1_000, NOW), 'just now');
    assert.equal(formatRelative(NOW - 30_000, NOW), 'just now');
  });

  it('returns "just now" for future timestamps (clock skew safety)', () => {
    assert.equal(formatRelative(NOW + 30_000, NOW), 'just now');
  });

  it('picks the minute unit for 1-59 min ago', () => {
    const v = formatRelative(NOW - 5 * MINUTE, NOW);
    // Intl output is locale-dependent; we just assert it contains "minute".
    assert.match(v, /minute/i);
  });

  it('picks the hour unit for 1-23h ago', () => {
    const v = formatRelative(NOW - 3 * HOUR, NOW);
    assert.match(v, /hour/i);
  });

  it('picks the day unit for 1-6 days ago', () => {
    const v = formatRelative(NOW - 2 * DAY, NOW);
    assert.match(v, /day/i);
  });

  it('picks the week unit for 1-4 weeks ago', () => {
    const v = formatRelative(NOW - 10 * DAY, NOW);
    assert.match(v, /week/i);
  });

  it('picks the month unit for 1-11 months ago', () => {
    const v = formatRelative(NOW - 3 * MONTH, NOW);
    assert.match(v, /month/i);
  });

  it('picks the year unit for >=1 year ago', () => {
    const v = formatRelative(NOW - 2 * YEAR, NOW);
    assert.match(v, /year/i);
  });
});

describe('isStaleOlderThanOneYear', () => {
  it('true when older than 1 year', () => {
    assert.equal(isStaleOlderThanOneYear(NOW - YEAR - DAY, NOW), true);
  });

  it('false when within 1 year', () => {
    assert.equal(isStaleOlderThanOneYear(NOW - MONTH, NOW), false);
    assert.equal(isStaleOlderThanOneYear(NOW - 11 * MONTH, NOW), false);
  });

  it('false when in the future', () => {
    assert.equal(isStaleOlderThanOneYear(NOW + DAY, NOW), false);
  });

  it('false right at the 1-year boundary (strict >)', () => {
    // YEAR ago, exactly — not stale (matches "older than 12 months")
    assert.equal(isStaleOlderThanOneYear(NOW - YEAR, NOW), false);
  });
});
