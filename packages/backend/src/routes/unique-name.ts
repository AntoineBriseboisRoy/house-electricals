/**
 * G42(a) cycle-49 — unique-name conflict detection helper.
 *
 * SQLite's UNIQUE constraint failure surfaces as an Error whose message
 * starts with "UNIQUE constraint failed:". We catch that one specific
 * failure mode and surface it as a 409 with the cycle-49 council-pinned
 * envelope: `{ error: { message: "Name 'X' is already taken." } }`.
 * The envelope shape is unchanged — NO new `suggested` field (Devil OBJ2
 * — would require widening @he/shared ApiError).
 *
 * Any non-UNIQUE error is re-thrown so the framework's default 500 path
 * handles it.
 */
export const isUniqueConstraintError = (err: unknown): boolean => {
  if (err === null || err === undefined) return false;
  // node:sqlite throws Error subclasses with a string `message`.
  if (typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string' && msg.includes('UNIQUE constraint failed')) {
      return true;
    }
  }
  return false;
};

/**
 * Build the canonical 409 ApiError body. Caller is responsible for
 * returning it with status 409 via `c.json(body, 409)`.
 */
export const uniqueNameTakenBody = (
  name: string
): { error: { message: string } } => ({
  error: { message: `Name '${name}' is already taken.` },
});
