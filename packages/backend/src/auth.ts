import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Single-user JWT-cookie auth (feat/auth-gate).
 *
 * Configuration is via environment variables — no DB-backed user store
 * (this is a single-homeowner self-hosted app, not a multi-tenant SaaS):
 *
 *   AUTH_USERNAME  — defaults to "admin"
 *   AUTH_PASSWORD  — REQUIRED. The backend fails to start without it
 *                    with a clear error.
 *   AUTH_SECRET    — optional. If not set, generated on first start
 *                    and persisted to `${DATA_DIR}/.auth-secret`
 *                    so existing sessions survive restarts. The file
 *                    is chmod 600 so only the container's nonroot UID
 *                    can read it.
 *
 * Token: JWT (HS256), 30-day expiry, httpOnly cookie named "he_auth".
 * Constant-time password compare to defeat timing oracles.
 */

const COOKIE_NAME = 'he_auth';
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type AuthConfig = {
  username: string;
  password: string; // raw (compared timing-safe)
  secret: string;
};

const DATA_DIR_DEFAULT = '/data';
const AUTH_SECRET_FILENAME = '.auth-secret';

export const loadAuthConfig = (): AuthConfig => {
  const username = process.env.AUTH_USERNAME?.trim() || 'admin';
  const password = process.env.AUTH_PASSWORD ?? '';
  if (password.length === 0) {
    throw new Error(
      [
        '',
        '─────────────────────────────────────────────────────────────',
        '  AUTH_PASSWORD is not set.',
        '─────────────────────────────────────────────────────────────',
        '  House Electricals refuses to start without a login',
        '  password. Set it in your compose.yaml or .env:',
        '',
        '    environment:',
        '      AUTH_PASSWORD: pick-a-strong-password-here',
        '',
        '  Optional: AUTH_USERNAME (defaults to "admin").',
        '─────────────────────────────────────────────────────────────',
        '',
      ].join('\n')
    );
  }

  const explicitSecret = process.env.AUTH_SECRET?.trim();
  let secret: string;
  if (explicitSecret !== undefined && explicitSecret.length > 0) {
    secret = explicitSecret;
  } else {
    secret = loadOrGenerateSecret();
  }
  return { username, password, secret };
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

export const verifyCredentials = (
  cfg: AuthConfig,
  username: string,
  password: string
): boolean => {
  // Length-prefixed comparison to keep `timingSafeEqual` constant-time
  // even when the inputs differ in length.
  const okUsername = constantTimeStringEqual(cfg.username, username);
  const okPassword = constantTimeStringEqual(cfg.password, password);
  return okUsername && okPassword;
};

const constantTimeStringEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Equalize length first so timingSafeEqual doesn't throw; XOR
    // result is always !== 0 below.
    const max = Math.max(aBuf.length, bBuf.length);
    const aPad = Buffer.alloc(max);
    const bPad = Buffer.alloc(max);
    aBuf.copy(aPad);
    bBuf.copy(bPad);
    timingSafeEqual(aPad, bPad);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
};

export const AUTH_COOKIE_NAME = COOKIE_NAME;
export const AUTH_TOKEN_MAX_AGE_SECONDS = TOKEN_MAX_AGE_SECONDS;
