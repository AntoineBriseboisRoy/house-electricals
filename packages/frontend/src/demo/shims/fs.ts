/**
 * Demo-only `node:fs` shim — fully self-contained (no memfs, which crashes at
 * module-eval expecting Node's Buffer). Backs the handful of sync fs calls the
 * backend's file/auth routes make with a trivial in-memory store.
 *
 * In the demo only the upload routes' writes actually run (mkdir/write/unlink);
 * the static `/files/*` serving route is never reached (our fetch interceptor
 * only routes `/api/v1/*`, and `<img src>` loads bypass it entirely), and the
 * auth fs calls are never invoked (`auth: null`). So a minimal store suffices.
 *
 * Aliased to `node:fs` (and `fs`) via resolve.alias in vite.demo.config.ts.
 */
const store = new Map<string, Uint8Array>();

export const mkdirSync = (): void => {};
export const chmodSync = (): void => {};
export const rmSync = (): void => {};

export const writeFileSync = (path: string, data: Uint8Array | string): void => {
  store.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
};

export const readFileSync = (path: string): Uint8Array => {
  const v = store.get(path);
  if (v === undefined) {
    const err = new Error(`ENOENT: no such file, open '${path}'`) as Error & { code: string };
    err.code = 'ENOENT';
    throw err;
  }
  return v;
};

export const existsSync = (path: string): boolean => store.has(path);

export const unlinkSync = (path: string): void => {
  store.delete(path);
};

export const statSync = (path: string): { isFile: () => boolean; size: number } => {
  const v = store.get(path);
  return { isFile: () => v !== undefined, size: v?.byteLength ?? 0 };
};

export const mkdtempSync = (prefix: string): string => `${prefix}demo`;

export default {
  mkdirSync,
  chmodSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  statSync,
  mkdtempSync,
};
