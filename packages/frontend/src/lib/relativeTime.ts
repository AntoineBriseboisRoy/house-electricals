/**
 * G36 cycle-61 — relative-time formatter for the breaker-test audit trail.
 *
 * Picks the largest applicable unit (year > month > week > day > hour >
 * minute > second) for the past-tense delta between `epochMs` and a
 * reference (defaults to Date.now()). Uses native `Intl.RelativeTimeFormat`
 * so we avoid pulling in a date library — pinned in CLAUDE.md.
 *
 * Examples:
 *   formatRelative(now - 1000)         → "just now"           (under 1 min)
 *   formatRelative(now - 5 * 60_000)   → "5 minutes ago"
 *   formatRelative(now - 2 * 3600_000) → "2 hours ago"
 *   formatRelative(now - 3 * 86400_000)→ "3 days ago"
 *   formatRelative(now - 10 * 86400_000)→ "1 week ago"
 *   formatRelative(now - 45 * 86400_000)→ "1 month ago"
 *   formatRelative(now - 400 * 86400_000)→ "1 year ago"
 *
 * Future-dated inputs (epochMs > now) return "just now" — the audit-trail
 * use case has no future timestamps, but we keep this monotonic.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY; // ~average month — Intl.RelativeTimeFormat does not bucket itself
const YEAR = 365 * DAY;

/** Pre-built formatter — instantiation cost is non-trivial on Safari. */
let formatter: Intl.RelativeTimeFormat | null = null;
const getFormatter = (): Intl.RelativeTimeFormat => {
  if (formatter !== null) return formatter;
  formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return formatter;
};

export const formatRelative = (
  epochMs: number,
  now: number = Date.now()
): string => {
  const deltaMs = epochMs - now; // negative for past
  const absMs = Math.abs(deltaMs);

  // Under one minute — collapse to a friendly literal.
  if (absMs < MINUTE) return 'just now';

  const fmt = getFormatter();
  // Intl.RelativeTimeFormat expects a SIGNED value: negative = past,
  // positive = future. We pass `Math.round(deltaMs / unit)` so a delta
  // of -3 days renders as "3 days ago" (en) / "il y a 3 jours" (fr).
  if (absMs < HOUR) {
    return fmt.format(Math.round(deltaMs / MINUTE), 'minute');
  }
  if (absMs < DAY) {
    return fmt.format(Math.round(deltaMs / HOUR), 'hour');
  }
  if (absMs < WEEK) {
    return fmt.format(Math.round(deltaMs / DAY), 'day');
  }
  if (absMs < MONTH) {
    return fmt.format(Math.round(deltaMs / WEEK), 'week');
  }
  if (absMs < YEAR) {
    return fmt.format(Math.round(deltaMs / MONTH), 'month');
  }
  return fmt.format(Math.round(deltaMs / YEAR), 'year');
};

/** Helper used by BreakerRow's "warn dot" decision — true when the test
 *  is older than 12 months (rounded to 365 days). */
export const isStaleOlderThanOneYear = (
  epochMs: number,
  now: number = Date.now()
): boolean => now - epochMs > YEAR;
