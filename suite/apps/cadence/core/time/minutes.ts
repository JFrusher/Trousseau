/**
 * Time in Cadence is an integer count of wall-clock minutes from the day's
 * 00:00. Values at or above 1440 belong to the following morning — a reception
 * ending at 01:30 is 1530. There is no Date, no timezone and no DST here.
 */

export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 24 * MIN_PER_HOUR;

/** `14:30`, `2:30pm`, `2.30pm`, `1430`, `9am`, and any of those with a ` +1` day suffix. */
const CLOCK =
  /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:\+\s*(\d))?\s*$/i;

/** `1430` and `0930` — four digits, no separator. */
const COMPACT = /^\s*(\d{2})(\d{2})\s*(?:\+\s*(\d))?\s*$/;

/**
 * Parses a clock time to minutes-from-00:00, or null if it is not a time.
 * A `+1` suffix adds a day, so `01:30 +1` is 1530.
 */
export function parseClock(input: string): number | null {
  const compact = COMPACT.exec(input);
  if (compact) {
    const hours = Number(compact[1]);
    const mins = Number(compact[2]);
    const days = compact[3] === undefined ? 0 : Number(compact[3]);
    if (hours > 23 || mins > 59) return null;
    return days * MIN_PER_DAY + hours * MIN_PER_HOUR + mins;
  }

  const match = CLOCK.exec(input);
  if (!match) return null;

  let hours = Number(match[1]);
  const mins = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  const days = match[4] === undefined ? 0 : Number(match[4]);

  if (mins > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "am") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  }

  return days * MIN_PER_DAY + hours * MIN_PER_HOUR + mins;
}

export interface FormatClockOptions {
  /** Show the ` +1` day suffix past midnight. Default true. */
  dayOffset?: boolean;
}

/** `14:30`, or `01:30 +1` for the morning after. */
export function formatClock(min: number, options: FormatClockOptions = {}): string {
  const showOffset = options.dayOffset ?? true;
  const days = Math.floor(min / MIN_PER_DAY);
  const withinDay = ((min % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const hours = Math.floor(withinDay / MIN_PER_HOUR);
  const mins = withinDay % MIN_PER_HOUR;
  const clock = `${pad(hours)}:${pad(mins)}`;
  return showOffset && days !== 0 ? `${clock} ${days > 0 ? "+" : "-"}${Math.abs(days)}` : clock;
}

/** `1h 25m`, `45m`, `2h`. Zero is `0m`. */
export function formatDuration(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  const hours = Math.floor(abs / MIN_PER_HOUR);
  const mins = abs % MIN_PER_HOUR;
  if (hours === 0) return `${sign}${mins}m`;
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${mins}m`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
