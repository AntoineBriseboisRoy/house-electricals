import pg from 'pg';

/**
 * Postgres connection layer.
 *
 * House Electricals moved off `node:sqlite` to PostgreSQL (branch
 * migrate/postgres) for reliability as the deployment scales. This file
 * is the ONLY place that talks to the `pg` driver directly — repositories
 * consume the `Querier` interface so the same code runs against the live
 * pool AND inside a transaction (a dedicated pooled client).
 *
 * Conventions pinned here:
 *
 * - **Epoch-ms timestamps are `BIGINT`.** Postgres `INTEGER` is 32-bit and
 *   `Date.now()` overflows it. The driver returns `BIGINT` (OID 20) as a
 *   string by default; the type parser below converts it back to a JS
 *   number. Epoch-ms fits comfortably in `Number.MAX_SAFE_INTEGER`.
 * - **Placeholders are `$1, $2, …`** (pg positional), NOT `?`.
 * - **Transactions use a dedicated client** (`pool.connect()`), never the
 *   pool's implicit per-query connection — BEGIN/COMMIT must run on the
 *   same physical connection.
 */

// BIGINT (OID 20) → JS number. Module-load side effect, runs once.
pg.types.setTypeParser(20, (value: string | null): number | null =>
  value === null ? null : Number.parseInt(value, 10)
);

export type QueryParams = ReadonlyArray<unknown>;

/**
 * The read/write surface repositories depend on. Implemented by both
 * `Db` (pool-backed) and the transactional client handed to
 * `Db.transaction`'s callback.
 */
export interface Querier {
  /** Run a query and return all rows. */
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: QueryParams
  ): Promise<R[]>;
  /** Run a query and return the first row, or null when there are none. */
  queryOne<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: QueryParams
  ): Promise<R | null>;
  /** Run a write and return the number of affected rows. */
  execute(sql: string, params?: QueryParams): Promise<number>;
}

const runQuery = async <R extends Record<string, unknown>>(
  exec: (sql: string, params: unknown[]) => Promise<pg.QueryResult>,
  sql: string,
  params: QueryParams
): Promise<R[]> => {
  const result = await exec(sql, params as unknown[]);
  return result.rows as R[];
};

class ClientQuerier implements Querier {
  constructor(private readonly client: pg.PoolClient) {}

  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: QueryParams = []
  ): Promise<R[]> {
    return runQuery<R>((s, p) => this.client.query(s, p), sql, params);
  }

  async queryOne<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: QueryParams = []
  ): Promise<R | null> {
    const rows = await this.query<R>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: QueryParams = []): Promise<number> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rowCount ?? 0;
  }
}

export class Db implements Querier {
  constructor(readonly pool: pg.Pool) {}

  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: QueryParams = []
  ): Promise<R[]> {
    return runQuery<R>((s, p) => this.pool.query(s, p), sql, params);
  }

  async queryOne<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: QueryParams = []
  ): Promise<R | null> {
    const rows = await this.query<R>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: QueryParams = []): Promise<number> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rowCount ?? 0;
  }

  /**
   * Run a raw SQL script (possibly several `;`-separated statements) through
   * pg's **simple** query protocol. This is the ONLY safe way to send
   * multi-statement DDL — the extended protocol (triggered whenever a
   * `values` array is passed, even an empty one) rejects strings containing
   * more than one command. Used exclusively by `initSchema` for trusted DDL;
   * NEVER call this with user-supplied input (no parameterization).
   */
  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  /**
   * Run `fn` inside a transaction on a dedicated pooled client. Commits on
   * resolve, rolls back on throw, always releases the client.
   */
  async transaction<T>(fn: (tx: Querier) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new ClientQuerier(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure — surface the original error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface PoolOptions {
  /**
   * Scope every connection to a named schema via `search_path`. Used by the
   * test harness to isolate each suite in its own schema; production leaves
   * this unset (uses the default `public` schema).
   */
  schema?: string;
  /** Max pool size. Defaults to pg's default (10). */
  max?: number;
  /**
   * Called when an **idle** pooled client emits an error — e.g. Postgres
   * restarted, an admin terminated the backend, or a network partition
   * dropped the connection. pg surfaces these on the pool's `'error'` event.
   *
   * Attaching a handler is NOT optional for a long-running server: with no
   * listener, Node treats the emitted `'error'` as an uncaught exception and
   * crashes the whole process — so a transient database blip would take the
   * app down even though the pool recovers on its own (the errored client is
   * discarded and the next query transparently opens a fresh connection).
   *
   * Defaults to logging via `console.error`. Override for custom logging or
   * to silence the noise in tests.
   */
  onError?: (err: Error) => void;
}

export const createPool = (
  connectionString: string,
  opts: PoolOptions = {}
): pg.Pool => {
  const config: pg.PoolConfig = { connectionString };
  if (opts.schema !== undefined) {
    // `-c search_path=…` is applied to every new connection at startup, so
    // unqualified DDL/DML lands in the isolated schema.
    config.options = `-c search_path=${opts.schema}`;
  }
  if (opts.max !== undefined) {
    config.max = opts.max;
  }
  const pool = new pg.Pool(config);
  const onError =
    opts.onError ??
    ((err: Error): void => {
      // Log and recover — do NOT exit. The pool drops the errored client and
      // the next query opens a new connection once Postgres is reachable
      // again. Crashing here would turn a transient DB hiccup into downtime.
      console.error(
        '[db] idle pool client error (pool will recover on next query):',
        err
      );
    });
  pool.on('error', onError);
  return pool;
};
