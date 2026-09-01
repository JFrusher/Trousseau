import { formatClock } from "../../core/time/minutes";

export interface Tick {
  min: number;
  label: string;
  /** Hours and half-days get a heavier rule and a label; the rest are hairlines. */
  major: boolean;
}

/** Intervals a planner reads without counting. */
const INTERVALS = [5, 10, 15, 30, 60, 120, 180, 360];

/** A label is about this wide at the ruler's type size, plus breathing room. */
export const MIN_LABEL_PX = 58;

/** A line of clock type is about this tall, plus breathing room, running down. */
export const MIN_LABEL_PITCH_PX = 24;

/** The smallest interval whose labels will not collide at this zoom. */
export function tickInterval(pxPerMin: number, minLabelPx = MIN_LABEL_PX): number {
  const fits = INTERVALS.find((interval) => interval * pxPerMin >= minLabelPx);
  return fits ?? (INTERVALS[INTERVALS.length - 1] as number);
}

/**
 * Ruler ticks across a span. Labelled ticks are spaced so they never overlap;
 * between them, unlabelled hairlines at a quarter of the interval keep the eye
 * honest without crowding.
 */
export function ticks(
  fromMin: number,
  toMin: number,
  pxPerMin: number,
  minLabelPx = MIN_LABEL_PX,
): Tick[] {
  if (toMin <= fromMin || pxPerMin <= 0) return [];

  const interval = tickInterval(pxPerMin, minLabelPx);
  const minor = interval >= 60 ? interval / 4 : interval / (interval % 3 === 0 ? 3 : 5);
  const step = Math.max(1, Math.round(minor));

  const first = Math.ceil(fromMin / step) * step;
  const out: Tick[] = [];
  for (let min = first; min <= toMin; min += step) {
    const major = min % interval === 0;
    out.push({ min, label: major ? formatClock(min) : "", major });
  }
  return out;
}

/** The window the canvas shows: the whole day, with air either side. */
export function spanOf(
  starts: { startMin: number; endMin: number }[],
  curfewMin: number,
): { fromMin: number; toMin: number } {
  if (starts.length === 0) return { fromMin: 480, toMin: Math.max(curfewMin, 1440) };
  const earliest = Math.min(...starts.map((entry) => entry.startMin));
  const latest = Math.max(curfewMin, ...starts.map((entry) => entry.endMin));
  return {
    fromMin: Math.floor((earliest - 30) / 30) * 30,
    toMin: Math.ceil((latest + 30) / 30) * 30,
  };
}
