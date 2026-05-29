/**
 * Demo-only `node:crypto` shim — fully self-contained (no crypto-browserify,
 * which crashes at module-eval in the browser expecting Node internals).
 *
 * `createHash` is the only function actually exercised in the demo: the
 * floor-plan / photo upload routes use it to build a content-hash filename.
 * Those uploads aren't displayable in the demo anyway (the <img> resource load
 * bypasses our fetch interceptor), so a fast non-cryptographic hash that yields
 * a stable hex string is sufficient. The auth/password helpers (`scrypt`,
 * `timingSafeEqual`, `randomBytes`) are imported at module-load but NEVER
 * invoked (`auth: null`); they only need to exist.
 *
 * Aliased to `node:crypto` (and `crypto`) via resolve.alias in vite.demo.config.ts.
 */

type Hasher = { update: (chunk: unknown) => Hasher; digest: (enc?: string) => string };

export const createHash = (_algorithm: string): Hasher => {
  let acc = '';
  const hasher: Hasher = {
    update(chunk: unknown) {
      acc += typeof chunk === 'string' ? chunk : `[${(chunk as { length?: number })?.length ?? 0}]`;
      return hasher;
    },
    digest(_enc?: string) {
      // FNV-1a → 32 hex chars. Not cryptographic; demo filenames only.
      let h = 0x811c9dc5;
      for (let i = 0; i < acc.length; i += 1) {
        h ^= acc.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      const hex = `0000000${h.toString(16)}`.slice(-8);
      return hex.repeat(4);
    },
  };
  return hasher;
};

const unavailable = (name: string) => (): never => {
  throw new Error(`[demo] node:crypto.${name} is unavailable in the demo build`);
};

export const randomBytes = (size: number): Uint8Array => {
  const out = new Uint8Array(size);
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a }).getRandomValues(out);
  return out;
};
export const createHmac = unavailable('createHmac');
export const pbkdf2 = unavailable('pbkdf2');
export const pbkdf2Sync = unavailable('pbkdf2Sync');
export const scrypt = unavailable('scrypt');
export const scryptSync = unavailable('scryptSync');
export const timingSafeEqual = (): boolean => false;

export default {
  createHash,
  createHmac,
  randomBytes,
  pbkdf2,
  pbkdf2Sync,
  scrypt,
  scryptSync,
  timingSafeEqual,
};
