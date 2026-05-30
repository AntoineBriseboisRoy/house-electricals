import { join, resolve, sep } from 'node:path';

/**
 * Defense-in-depth guard for filesystem writes/unlinks whose filename comes
 * from the DB or from an import payload (G46 FIX 4).
 *
 * Historically every floor-plan / photo filename is SERVER-GENERATED
 * (`<floorId>-<sha8>.<ext>` or `photo-<ulid>-<sha8>.<ext>`), so an unguarded
 * `join(dir, filename)` was safe. But the building-import route now ingests a
 * `floorPlan.filename` field from an attacker-controlled JSON payload, and any
 * future code path that round-trips a DB-stored filename should not be able to
 * escape FLOOR_PLAN_DIR via `..` / absolute paths / path separators.
 *
 * `assertInsideDir(dir, filename)` returns the resolved absolute path IFF the
 * filename is a single safe path segment that resolves to a location strictly
 * inside `dir`; otherwise it returns `null`. Callers MUST null-check the result
 * before touching the filesystem.
 *
 * Mirrors the static-serve hardening in routes/dev-static.ts (same rejection
 * rules) so reads and writes share one contract.
 */
export const assertInsideDir = (
  dir: string,
  filename: string
): string | null => {
  // Reject anything that isn't a plain single path segment. A leading `.`
  // blocks `.` / `..` / dotfiles; the separator checks block traversal and
  // absolute Windows/POSIX paths; the NUL check blocks poison-byte tricks.
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    filename.includes('\0') ||
    filename.startsWith('.')
  ) {
    return null;
  }
  const base = resolve(dir);
  const full = resolve(join(base, filename));
  // Belt-and-suspenders: the resolved path must still live inside `dir`.
  if (full !== base && !full.startsWith(base + sep)) {
    return null;
  }
  // A bare filename never equals the dir itself; that case means the segment
  // collapsed away (shouldn't happen given the checks above) — reject it.
  if (full === base) {
    return null;
  }
  return full;
};

/**
 * Regex for a single safe filename segment — used by the import route to
 * validate a payload-supplied `floor_plan_filename` before it touches the DB.
 * Same character class the server-generated filenames already satisfy.
 */
export const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;

/** True when `filename` is a single safe segment (no traversal, no separators)
 *  AND matches the conservative filename character whitelist. */
export const isSafeFilename = (filename: unknown): filename is string =>
  typeof filename === 'string' &&
  filename.length > 0 &&
  filename.length <= 255 &&
  !filename.startsWith('.') &&
  SAFE_FILENAME_RE.test(filename);
