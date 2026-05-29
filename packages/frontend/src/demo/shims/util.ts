/**
 * Demo-only `node:util` shim. `password.ts` does `const scrypt =
 * promisify(scryptCb)` at module-load, so `promisify` must be a working
 * function. A minimal Node-compatible implementation is enough (the wrapped
 * scrypt is never actually called in the no-auth demo).
 *
 * Aliased to `node:util` (and `util`) via resolve.alias in vite.demo.config.ts.
 */
type AnyFn = (...args: unknown[]) => unknown;

export const promisify = (fn: AnyFn) =>
  (...args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      fn(...args, (err: unknown, value: unknown) =>
        err ? reject(err) : resolve(value)
      );
    });

export default { promisify };
