/**
 * G42(a) cycle-49 — duplicate-name suffix helper.
 *
 * Used by create/rename flows when the backend returns 409 ("Name 'X' is
 * already taken."). The client-side helper computes a suggested candidate
 * the user can accept (or override) in the re-prompted modal. The backend
 * deliberately does NOT return a `suggested` field — see CLAUDE.md
 * "UNIQUE name constraints (G42(a) — cycle-49)" §4.
 *
 * Algorithm: if the name ends in " (N)" where N is a non-negative integer,
 * bump N by 1; otherwise append " (2)". Non-numeric parenthetical suffixes
 * (e.g. "Foo (bar)") get a fresh " (2)" appended — the existing suffix is
 * preserved as part of the base name.
 *
 *   "Foo"        → "Foo (2)"
 *   "Foo (2)"    → "Foo (3)"
 *   "Foo (10)"   → "Foo (11)"
 *   ""           → " (2)"          (edge case — document, don't special-case)
 *   "Foo (bar)"  → "Foo (bar) (2)" (non-numeric suffix is not a counter)
 */
export const suffixDuplicate = (name: string): string => {
  const match = name.match(/^(.*) \((\d+)\)$/);
  if (match !== null) {
    const base = match[1] ?? '';
    const n = Number.parseInt(match[2] ?? '0', 10);
    return `${base} (${n + 1})`;
  }
  return `${name} (2)`;
};
