/**
 * Demo backend connection layer — a `pg.Pool` look-alike backed by PGlite
 * (real Postgres compiled to WASM, running in the browser).
 *
 * This is the ONE swap that lets the entire real backend run in the browser:
 * `packages/backend/src/db.ts`'s `Db` class only ever calls `pool.query`,
 * `pool.connect`, `pool.on`, and `pool.end`. A structural stand-in for those
 * four methods is all it needs — so every repository, route, zod schema, and
 * cascade (including `Db.transaction(...)`) runs the real production code.
 */
// PGlite (Postgres compiled to WASM) is loaded from a CDN rather than bundled.
// Vite 8's rolldown can't bundle PGlite's npm ESM (it statically imports
// `fs/promises` and resolves its wasm via `new URL`). jsDelivr's `/+esm`
// endpoint serves a genuinely browser-targeted bundle (platform:browser — node
// builtins stubbed, so PGlite takes its fetch-the-wasm path, not the fs path
// that esm.sh's unenv polyfill wrongly triggers). The import stays external in
// both dev and build. This is the demo's ONLY runtime CDN dependency; the
// self-hostable product bundles everything locally. Pinned to the dep version.
// @ts-ignore -- external URL import, resolved at runtime in the browser.
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/+esm';
import type { Pool } from 'pg';
import { Db } from '../../../backend/src/db.js';

type PgResult = { rows: Record<string, unknown>[]; rowCount: number };

const toResult = (r: {
  rows?: readonly unknown[];
  affectedRows?: number;
}): PgResult => ({
  rows: (r.rows ?? []) as Record<string, unknown>[],
  rowCount: r.affectedRows ?? r.rows?.length ?? 0,
});

/**
 * PGlite is single-connection, so the "pool" and its "client" are the same
 * underlying handle. That is exactly what `Db.transaction` needs: it issues
 * BEGIN / COMMIT / ROLLBACK and the dependent statements on one client, and
 * here they all hit the one PGlite connection → a real transaction.
 */
class PglitePool {
  constructor(private readonly pg: PGlite) {}

  // `Db.query`/`execute` always pass a params array (default []). `Db.exec`
  // and the literal `client.query('BEGIN'|'COMMIT'|'ROLLBACK')` pass NO second
  // arg — those need the simple protocol (`pg.exec`), which alone handles
  // multi-statement DDL + transaction-control statements.
  query = async (sql: string, params?: unknown[]): Promise<PgResult> => {
    if (params === undefined) {
      const results = await this.pg.exec(sql);
      const last = results[results.length - 1] ?? { rows: [], affectedRows: 0 };
      return toResult(last);
    }
    return toResult(await this.pg.query(sql, params));
  };

  connect = async (): Promise<{
    query: PglitePool['query'];
    release: () => void;
  }> => ({ query: this.query, release: () => {} });

  on = (): void => {};

  end = async (): Promise<void> => {
    await this.pg.close();
  };
}

// PGlite's bundled CDN module can't resolve its own wasm/data via
// `new URL(…, import.meta.url)` (the +esm bundle URL points elsewhere), so we
// fetch both from jsDelivr's raw package files and hand them to PGlite
// explicitly — which skips its internal URL resolution entirely.
const PGLITE_ASSETS = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist';

/** Build a real `Db` backed by an in-memory PGlite instance. */
export const createDemoDb = async (): Promise<Db> => {
  const [wasmModule, fsBundle] = await Promise.all([
    WebAssembly.compileStreaming(fetch(`${PGLITE_ASSETS}/postgres.wasm`)),
    fetch(`${PGLITE_ASSETS}/postgres.data`).then((r) => r.blob()),
  ]);
  const pg = await PGlite.create({
    dataDir: 'memory://',
    wasmModule,
    fsBundle,
    parsers: {
      // int8 / BIGINT (OID 20) → JS number. Mirrors db.ts's
      // `pg.types.setTypeParser(20, …)`: epoch-ms timestamps are BIGINT and
      // the app expects them back as numbers (they fit in MAX_SAFE_INTEGER).
      20: (value: string) =>
        value === null ? null : Number.parseInt(value, 10),
    },
  });
  return new Db(new PglitePool(pg) as unknown as Pool);
};
