/**
 * feat/auth-gate — shared helper used by every e2e spec that hits the
 * isolated backend directly (not via the Playwright `page` fixture).
 *
 * Reads the session cookie globalSetup wrote to `e2e/.auth.json` and
 * threads it onto every request. The base URL is the isolated backend
 * spun up by globalSetup; specs can also pass absolute URLs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AUTH_FILE = join(__dirname, '.auth.json');

let cachedCookie: string | null = null;
const loadCookie = (): string => {
  if (cachedCookie !== null) return cachedCookie;
  let raw: string;
  try {
    raw = readFileSync(AUTH_FILE, 'utf8');
  } catch (e) {
    throw new Error(
      `[authedFetch] Could not read ${AUTH_FILE} — has globalSetup run? ${
        (e as Error).message
      }`
    );
  }
  const j = JSON.parse(raw) as {
    cookies: { name: string; value: string }[];
  };
  const c = j.cookies.find((x) => x.name === 'he_auth');
  if (c === undefined) {
    throw new Error('[authedFetch] he_auth cookie missing from .auth.json');
  }
  cachedCookie = `he_auth=${c.value}`;
  return cachedCookie;
};

export const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

/** Cookie-attaching fetch wrapper. Mirrors the global fetch signature
 *  so specs can drop-in replace `fetch(...)` with `authedFetch(...)`. */
export const authedFetch = (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(init.headers ?? {});
  // Don't clobber a cookie the caller explicitly set.
  if (!headers.has('cookie')) headers.set('cookie', loadCookie());
  return fetch(input, { ...init, headers });
};
