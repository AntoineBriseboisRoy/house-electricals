import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Single-user JWT-cookie auth (feat/auth-gate + sign-up flow).
 *
 * Credentials live in the SQLite `app_users` table — minted on first
 * boot via the public `POST /auth/signup` endpoint. There is exactly 0
 * or 1 user row at any moment. AUTH_USERNAME / AUTH_PASSWORD env vars
 * are NO LONGER consumed — earlier feat/auth-gate cycles read them
 * directly; that path is gone.
 *
 * The only env-derivable secret left is:
 *
 *   AUTH_SECRET  — optional. If not set, auto-generated on first start
 *                  and persisted to `${DATA_DIR}/.auth-secret` so
 *                  existing sessions survive restarts. The file is
 *                  chmod 600 so only the container's nonroot UID can
 *                  read it. Deleting the file is the canonical
 *                  "log everyone out" lever (cookies become unverifiable
 *                  even though the user row is untouched).
 *
 * Token: JWT (HS256), 30-day expiry, httpOnly cookie named "he_auth".
 */

const COOKIE_NAME = 'he_auth';
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type AuthConfig = {
  /** HMAC secret for signing the `he_auth` JWT cookie. */
  secret: string;
};

const DATA_DIR_DEFAULT = '/data';
const AUTH_SECRET_FILENAME = '.auth-secret';

export const loadAuthConfig = (): AuthConfig => {
  const explicitSecret = process.env.AUTH_SECRET?.trim();
  let secret: string;
  if (explicitSecret !== undefined && explicitSecret.length > 0) {
    secret = explicitSecret;
  } else {
    secret = loadOrGenerateSecret();
  }
  return { secret };
};

const loadOrGenerateSecret = (): string => {
  // Use the directory of DB_PATH as a stable per-deployment location for
  // the auto-generated secret (same place the SQLite file lives).
  const dbPath = process.env.DB_PATH ?? join(DATA_DIR_DEFAULT, 'panels.db');
  const dataDir = dirname(dbPath);
  const path = join(dataDir, AUTH_SECRET_FILENAME);
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length >= 32) return raw;
    // File exists but is bogus — fall through and regenerate.
  }
  mkdirSync(dataDir, { recursive: true });
  const fresh = randomBytes(48).toString('hex'); // 96 hex chars
  writeFileSync(path, fresh + '\n', { encoding: 'utf8' });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on platforms that don't fully support POSIX modes
    // (Windows Docker Desktop / WSL VFS); the inside-the-container
    // file system honors it.
  }
  return fresh;
};

export const AUTH_COOKIE_NAME = COOKIE_NAME;
export const AUTH_TOKEN_MAX_AGE_SECONDS = TOKEN_MAX_AGE_SECONDS;
