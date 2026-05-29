/**
 * Demo-only stub for the `pg` package. `packages/backend/src/db.ts` does
 * `import pg from 'pg'` and calls `pg.types.setTypeParser(...)` at module
 * load, and references `pg.Pool` inside `createPool`. In the demo we never
 * call `createPool` (we build a PGlite-backed pool ourselves — see
 * `pglite-pool.ts`), so only the module-load side effect needs to be inert.
 *
 * Aliased to `pg` via `resolve.alias` in `vite.demo.config.ts`.
 */
const noopTypes = {
  setTypeParser(): void {
    /* parsing handled by PGlite's own `parsers` option in pglite-pool.ts */
  },
};

class Pool {}
class PoolClient {}

export default { types: noopTypes, Pool, PoolClient };
export { noopTypes as types, Pool, PoolClient };
