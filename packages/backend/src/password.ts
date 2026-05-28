import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing for the single-user login gate (feat/auth-gate +
 * sign-up flow). Replaces the env-var-only password model.
 *
 * Algorithm: scrypt (memory-hard, built into node:crypto — no native
 * deps, no Argon2 module needed). Parameters live INSIDE the encoded
 * string so we can rotate them in the future without breaking existing
 * users.
 *
 * Encoding (PHC-ish, custom — not the formal `crypt(3)` PHC string):
 *   scrypt$N=<n>,r=<r>,p=<p>$<salt-base64>$<hash-base64>
 *
 * Picked: N=32768 (2^15), r=8, p=1 — modern defaults that still hash
 * in <200ms on the kind of small home server this app targets. Salt is
 * 16 random bytes; hash output is 64 bytes (512 bits).
 *
 * Verification re-derives with the parameters embedded in the stored
 * string, then `timingSafeEqual`s the result. We do NOT branch on
 * mismatched lengths in the user-visible path — equal-length compare
 * is always performed.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number }
) => Promise<Buffer>;

// Defaults — embedded in the encoded string so older hashes still
// verify after we rotate these.
const DEFAULT_N = 32768; // 2^15
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 64;
// scrypt requires maxmem >= 128*N*r — set generously so a future
// parameter bump doesn't trip the default 32 MiB ceiling. 256 MiB
// covers N up to ~256k.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, HASH_BYTES, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return formatEncoded(DEFAULT_N, DEFAULT_R, DEFAULT_P, salt, derived);
};

/**
 * Verify a supplied password against a previously stored encoded
 * hash. Returns false for a malformed stored value (rather than
 * throwing) so a corrupted row degrades to "wrong password" instead
 * of a 500.
 */
export const verifyPassword = async (
  supplied: string,
  encoded: string
): Promise<boolean> => {
  const parsed = parseEncoded(encoded);
  if (parsed === null) return false;
  const { N, r, p, salt, hash } = parsed;
  let derived: Buffer;
  try {
    derived = await scrypt(supplied, salt, hash.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    // Out-of-range params or other scrypt error — treat as mismatch.
    return false;
  }
  if (derived.length !== hash.length) return false;
  return timingSafeEqual(derived, hash);
};

const formatEncoded = (
  N: number,
  r: number,
  p: number,
  salt: Buffer,
  hash: Buffer
): string =>
  `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${hash.toString(
    'base64'
  )}`;

type Parsed = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

const parseEncoded = (encoded: string): Parsed | null => {
  const parts = encoded.split('$');
  if (parts.length !== 4) return null;
  const [algo, paramStr, saltB64, hashB64] = parts;
  if (algo !== 'scrypt') return null;
  const params: Record<string, number> = {};
  for (const pair of paramStr.split(',')) {
    const [k, vRaw] = pair.split('=');
    if (k === undefined || vRaw === undefined) return null;
    const v = Number.parseInt(vRaw, 10);
    if (!Number.isFinite(v) || v <= 0) return null;
    params[k] = v;
  }
  if (
    params.N === undefined ||
    params.r === undefined ||
    params.p === undefined
  ) {
    return null;
  }
  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    hash = Buffer.from(hashB64, 'base64');
  } catch {
    return null;
  }
  if (salt.length === 0 || hash.length === 0) return null;
  return { N: params.N, r: params.r, p: params.p, salt, hash };
};
