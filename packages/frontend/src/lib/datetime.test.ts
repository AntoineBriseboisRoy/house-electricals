/**
 * Unit tests for the app-wide timezone helpers. Run via the backend's tsx:
 *   packages/backend/node_modules/.bin/tsx --test packages/frontend/src/lib/datetime.test.ts
 * (NodeNext resolution → import the sibling as `./datetime.js`.)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAppTimeZone,
  getAppTimeZone,
  dateInputValue,
  epochFromDateInputStart,
  epochFromDateInputEnd,
  zonedWallToEpoch,
  startOfMonthEpoch,
} from './datetime.js';

describe('setAppTimeZone / getAppTimeZone', () => {
  beforeEach(() => setAppTimeZone(null));

  it('stores a valid IANA zone', () => {
    setAppTimeZone('America/Toronto');
    assert.equal(getAppTimeZone(), 'America/Toronto');
  });

  it('trims whitespace', () => {
    setAppTimeZone('  UTC  ');
    assert.equal(getAppTimeZone(), 'UTC');
  });

  it('falls back to null for empty / invalid zones', () => {
    setAppTimeZone('');
    assert.equal(getAppTimeZone(), null);
    setAppTimeZone('Not/AZone');
    assert.equal(getAppTimeZone(), null);
    setAppTimeZone(undefined);
    assert.equal(getAppTimeZone(), null);
  });
});

describe('epochFromDateInputStart', () => {
  beforeEach(() => setAppTimeZone(null));

  it('returns null for malformed input', () => {
    assert.equal(epochFromDateInputStart(''), null);
    assert.equal(epochFromDateInputStart('2024-1-1'), null);
    assert.equal(epochFromDateInputStart('garbage'), null);
  });

  it('UTC zone → midnight UTC', () => {
    setAppTimeZone('UTC');
    assert.equal(
      epochFromDateInputStart('2024-01-15'),
      Date.UTC(2024, 0, 15, 0, 0, 0, 0)
    );
  });

  it('America/Toronto winter (EST, UTC-5) → 05:00 UTC', () => {
    setAppTimeZone('America/Toronto');
    assert.equal(
      epochFromDateInputStart('2024-01-15'),
      Date.UTC(2024, 0, 15, 5, 0, 0, 0)
    );
  });

  it('America/Toronto summer (EDT, UTC-4) → 04:00 UTC', () => {
    setAppTimeZone('America/Toronto');
    assert.equal(
      epochFromDateInputStart('2024-07-15'),
      Date.UTC(2024, 6, 15, 4, 0, 0, 0)
    );
  });
});

describe('epochFromDateInputEnd', () => {
  it('is end-of-day (23:59:59.999) in the zone', () => {
    setAppTimeZone('UTC');
    assert.equal(
      epochFromDateInputEnd('2024-01-15'),
      Date.UTC(2024, 0, 15, 23, 59, 59, 999)
    );
    setAppTimeZone(null);
  });
});

describe('dateInputValue round-trips epochFromDateInputStart', () => {
  for (const tz of ['UTC', 'America/Toronto', 'Asia/Kolkata']) {
    it(`round-trips in ${tz}`, () => {
      setAppTimeZone(tz);
      for (const day of ['2024-01-15', '2024-07-15', '2024-12-31']) {
        const epoch = epochFromDateInputStart(day);
        assert.notEqual(epoch, null);
        assert.equal(dateInputValue(epoch), day);
      }
      setAppTimeZone(null);
    });
  }

  it('returns empty string for null', () => {
    assert.equal(dateInputValue(null), '');
  });
});

describe('zonedWallToEpoch DST correctness', () => {
  it('handles the day after spring-forward', () => {
    setAppTimeZone('America/Toronto');
    // 2024-03-10 spring-forward (02:00 → 03:00). The 11th is firmly EDT (-4):
    // midnight local = 04:00 UTC.
    assert.equal(
      zonedWallToEpoch(2024, 3, 11, 0, 0, 0, 0),
      Date.UTC(2024, 2, 11, 4, 0, 0, 0)
    );
    setAppTimeZone(null);
  });
});

describe('startOfMonthEpoch', () => {
  it('is midnight on the 1st of the given instant’s month, in zone', () => {
    setAppTimeZone('UTC');
    const mid = Date.UTC(2024, 6, 18, 13, 30, 0, 0); // 2024-07-18 in UTC
    assert.equal(startOfMonthEpoch(mid), Date.UTC(2024, 6, 1, 0, 0, 0, 0));
    setAppTimeZone(null);
  });
});
