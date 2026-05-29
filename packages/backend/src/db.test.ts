import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from './db.js';

// These tests cover pool-level wiring only — they never connect to Postgres.
// `new pg.Pool(...)` is lazy: no socket opens until the first query. We can
// therefore construct a pool with a throwaway connection string and exercise
// its 'error' event synchronously, then end() it without ever touching a DB.
const DUMMY_URL = 'postgresql://nobody:nobody@127.0.0.1:1/none';

describe('createPool — idle-client error handling', () => {
  it('always attaches an error listener so an idle-client error cannot crash the process', async () => {
    const pool = createPool(DUMMY_URL);
    try {
      // With no listener, pg re-emits this as an uncaught 'error' and Node
      // tears the process down. A listener being present is the contract.
      assert.ok(
        pool.listenerCount('error') >= 1,
        'pool must have at least one error listener'
      );
      // Emitting must not throw (i.e. the event is handled, not uncaught).
      assert.doesNotThrow(() => {
        pool.emit('error', new Error('simulated idle-client drop'), undefined);
      });
    } finally {
      await pool.end();
    }
  });

  it('routes idle-client errors to a caller-supplied onError handler', async () => {
    const seen: Error[] = [];
    const pool = createPool(DUMMY_URL, {
      onError: (err) => {
        seen.push(err);
      },
    });
    try {
      const boom = new Error('postgres restarted');
      pool.emit('error', boom, undefined);
      assert.equal(seen.length, 1);
      assert.equal(seen[0], boom);
    } finally {
      await pool.end();
    }
  });
});
