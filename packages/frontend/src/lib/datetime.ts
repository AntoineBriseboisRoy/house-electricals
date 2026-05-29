/**
 * App-wide timezone handling.
 *
 * The operator can pin the whole app to one IANA timezone via the backend's
 * `TZ` env var (surfaced at GET /api/v1/config). Every date the UI shows — and
 * every `<input type="date">` ↔ epoch-ms conversion — goes through these
 * helpers so the displayed/edited day matches that configured zone on ANY
 * device. When no zone is configured (`setAppTimeZone(null)`), the helpers pass
 * `timeZone: undefined` to `Intl`, which means "use the device's local zone" —
 * byte-identical to the historical behavior.
 *
 * Timestamps themselves are always epoch ms (timezone-independent); only the
 * wall-clock interpretation for display/picking depends on the zone.
 */

// null = use the device's local zone (the default until /config loads).
let appTimeZone: string | null = null;

/**
 * Set the app-wide display timezone. Pass an IANA name (e.g. "America/Toronto")
 * or null to use the device's local zone. An invalid/empty name falls back to
 * the device zone rather than throwing — a misconfigured `TZ` must never white-
 * screen the app.
 */
export const setAppTimeZone = (tz: string | null | undefined): void => {
  const trimmed = tz?.trim();
  if (!trimmed) {
    appTimeZone = null;
    return;
  }
  try {
    // Constructing with an invalid timeZone throws a RangeError.
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    appTimeZone = trimmed;
  } catch {
    appTimeZone = null;
  }
};

/** The configured app timezone, or null when none is set (device-local). */
export const getAppTimeZone = (): string | null => appTimeZone;

/** `Intl` timeZone option: the configured zone, or undefined (device-local). */
const zone = (): string | undefined => appTimeZone ?? undefined;

// ── Display formatting ───────────────────────────────────────────────────────

/** Format an epoch-ms timestamp using the app zone. Defaults to a short
 *  date+time; override via `opts`. */
export const formatDateTime = (
  epochMs: number,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
): string =>
  new Intl.DateTimeFormat(undefined, { timeZone: zone(), ...opts }).format(
    new Date(epochMs)
  );

/** Format an epoch-ms timestamp as a date (no time) using the app zone. */
export const formatDate = (
  epochMs: number,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string =>
  new Intl.DateTimeFormat(undefined, { timeZone: zone(), ...opts }).format(
    new Date(epochMs)
  );

// ── Wall-clock ↔ epoch conversion (in the app zone) ──────────────────────────

type WallParts = {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
};

/** Decompose an epoch instant into wall-clock parts in the app zone. */
const wallParts = (epochMs: number): WallParts => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone(),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    // h23 renders midnight as "24" in some engines — normalize to 0.
    h: Number(map.hour) % 24,
    mi: Number(map.minute),
    s: Number(map.second),
  };
};

/** Offset (ms) of the app zone at a given UTC instant: zoneWallAsUTC − utc. */
const zoneOffsetMs = (utcMs: number): number => {
  const { y, mo, d, h, mi, s } = wallParts(utcMs);
  return Date.UTC(y, mo - 1, d, h, mi, s) - utcMs;
};

/**
 * Epoch ms for a wall-clock time interpreted in the app zone. Uses the
 * standard two-pass offset technique so the result is correct even across a
 * DST transition (the first guess can be off by the DST delta; one correction
 * fixes it).
 */
export const zonedWallToEpoch = (
  y: number,
  mo: number, // 1-12
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0
): number => {
  // Resolve the offset at WHOLE-SECOND granularity — `wallParts` reads from
  // `Intl`, which has no sub-second precision, so a millisecond folded into
  // the offset guess would corrupt it. Add `ms` back after the conversion.
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = zoneOffsetMs(utcGuess);
  let epoch = utcGuess - off1;
  const off2 = zoneOffsetMs(epoch);
  if (off2 !== off1) epoch = utcGuess - off2;
  return epoch + ms;
};

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" for `<input type="date">` from an epoch ms (app zone). Empty
 *  string for null. */
export const dateInputValue = (epochMs: number | null): string => {
  if (epochMs === null) return '';
  const { y, mo, d } = wallParts(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
};

/** "YYYY-MM-DD" → epoch ms at the START of that day in the app zone. Returns
 *  null when the string isn't a valid date input. */
export const epochFromDateInputStart = (value: string): number | null => {
  const m = DATE_INPUT_RE.exec(value.trim());
  if (m === null) return null;
  return zonedWallToEpoch(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, 0);
};

/** "YYYY-MM-DD" → epoch ms at the END of that day (23:59:59.999) in the app
 *  zone — for inclusive "until <day>" range filters. Null when invalid. */
export const epochFromDateInputEnd = (value: string): number | null => {
  const m = DATE_INPUT_RE.exec(value.trim());
  if (m === null) return null;
  return zonedWallToEpoch(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    23,
    59,
    59,
    999
  );
};

/** Epoch ms at the start of the current month in the app zone. */
export const startOfMonthEpoch = (nowMs: number = Date.now()): number => {
  const { y, mo } = wallParts(nowMs);
  return zonedWallToEpoch(y, mo, 1, 0, 0, 0, 0);
};
