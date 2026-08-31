import { formatClock, formatDuration } from "../time/minutes";
import { isMoment, type TimelineDoc } from "../model/types";
import { blocksById, byId, byLane, type ResolvedBlock } from "./resolve";

export type ConflictKind =
  | "lane-overlap"
  | "tag-double-booked"
  | "anchor-collision"
  | "curfew-overrun"
  | "past-golden-hour"
  | "squeezed";

/** Conflicts block export. Advisories never do. */
export type Severity = "conflict" | "advisory";

export interface Conflict {
  kind: ConflictKind;
  severity: Severity;
  blockIds: string[];
  message: string;
}

export interface ConflictOptions {
  /** Minutes-from-00:00 at which usable evening light ends. Omitted: no advisory. */
  goldenHourEndMin?: number;
}

/** Blocks carrying this tag are photography, for the golden-hour advisory. */
export const PHOTO_TAG = "photo";

/** Strictly, so a moment — which has no length — never overlaps anything. */
function overlaps(a: ResolvedBlock, b: ResolvedBlock): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export function conflicts(
  resolved: ResolvedBlock[],
  doc: TimelineDoc,
  options: ConflictOptions = {},
): Conflict[] {
  const blocks = blocksById(doc);
  const label = (id: string) => blocks.get(id)?.label ?? id;
  const found: Conflict[] = [];

  const moment = (id: string) => isMoment(blocks.get(id) ?? { durationMin: 1 });

  for (const [lane, entries] of byLane(resolved)) {
    // A moment pinned inside something already running is the point of moments,
    // not a clash: it costs the lane nothing and displaces nothing. So the scan
    // steps over them — on both sides, or a moment sitting between two blocks
    // would hide the collision they are actually in.
    let previous = entries[0] && !moment(entries[0].id) ? entries[0] : undefined;

    for (let i = 1; i < entries.length; i += 1) {
      const current = entries[i];
      if (!current || moment(current.id)) continue;
      const overrun = previous;
      previous = current;
      if (!overrun) continue;
      if (!current.anchored || current.startMin >= overrun.endMin) continue;

      // Both fixed and overlapping is a plain collision. A floating chain that
      // has grown into a downstream anchor is a different problem with a
      // different fix, so it gets its own kind.
      const kind: ConflictKind = overrun.anchored ? "lane-overlap" : "anchor-collision";
      const overlapMin = overrun.endMin - current.startMin;
      found.push({
        kind,
        severity: "conflict",
        blockIds: [overrun.id, current.id],
        message:
          kind === "lane-overlap"
            ? `${label(overrun.id)} runs until ${formatClock(overrun.endMin)}, ${overlapMin} minutes past the start of ${label(current.id)} in ${lane}.`
            : `${label(overrun.id)} overruns into ${label(current.id)} at ${formatClock(current.startMin)} by ${overlapMin} minutes. Shorten something earlier in ${lane}.`,
      });
    }

    const last = entries[entries.length - 1];
    if (last && last.endMin > doc.day.curfewMin) {
      found.push({
        kind: "curfew-overrun",
        severity: "conflict",
        blockIds: [last.id],
        message: `${lane} ends at ${formatClock(last.endMin)}, ${last.endMin - doc.day.curfewMin} minutes past the ${formatClock(doc.day.curfewMin)} curfew.`,
      });
    }
  }

  // Squeezing is never silent: a block printed shorter than it was typed says so.
  for (const entry of resolved) {
    if (entry.squeezedMin <= 0) continue;
    const block = blocks.get(entry.id);
    if (!block) continue;
    found.push({
      kind: "squeezed",
      severity: "advisory",
      blockIds: [entry.id],
      message: `${block.label} is squeezed by ${entry.squeezedMin} minutes, to ${formatDuration(
        entry.contentEndMin - entry.startMin,
      )}, to make what is anchored after it.`,
    });
  }

  found.push(...tagDoubleBookings(resolved, doc, label));

  const goldenHourEndMin = options.goldenHourEndMin;
  if (goldenHourEndMin !== undefined) {
    for (const entry of resolved) {
      const block = blocks.get(entry.id);
      if (!block?.tags.includes(PHOTO_TAG)) continue;
      if (entry.startMin <= goldenHourEndMin) continue;
      found.push({
        kind: "past-golden-hour",
        severity: "advisory",
        blockIds: [entry.id],
        message: `${block.label} starts at ${formatClock(entry.startMin)}, after the light goes at ${formatClock(goldenHourEndMin)}.`,
      });
    }
  }

  return found;
}

/**
 * The same tag in two places at once. Same-lane overlap is already reported as
 * a lane collision, so only cross-lane pairs are counted here.
 */
function tagDoubleBookings(
  resolved: ResolvedBlock[],
  doc: TimelineDoc,
  label: (id: string) => string,
): Conflict[] {
  const positions = byId(resolved);
  const lengths = blocksById(doc);
  const byTag = new Map<string, ResolvedBlock[]>();
  for (const block of doc.blocks) {
    const entry = positions.get(block.id);
    if (!entry) continue;
    for (const tag of block.tags) {
      const group = byTag.get(tag);
      if (group) group.push(entry);
      else byTag.set(tag, [entry]);
    }
  }

  const found: Conflict[] = [];
  for (const [tag, entries] of byTag) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i];
        const b = entries[j];
        if (!a || !b || a.lane === b.lane || !overlaps(a, b)) continue;
        // A moment inside something else is a person stepping away for a
        // minute, not a person in two places: worth saying, never worth
        // blocking the print run over.
        const point =
          isMoment(lengths.get(a.id) ?? { durationMin: 1 }) ||
          isMoment(lengths.get(b.id) ?? { durationMin: 1 });
        found.push({
          kind: "tag-double-booked",
          severity: point ? "advisory" : "conflict",
          blockIds: [a.id, b.id],
          message: point
            ? `${tag} is wanted at ${label(a.id)} and ${label(b.id)} at ${formatClock(Math.max(a.startMin, b.startMin))}. One of them is a moment, so it may well be fine.`
            : `${tag} is in two places at ${formatClock(Math.max(a.startMin, b.startMin))} — ${label(a.id)} and ${label(b.id)}.`,
        });
      }
    }
  }
  return found;
}

export function blockingConflicts(all: Conflict[]): Conflict[] {
  return all.filter((entry) => entry.severity === "conflict");
}

/** Conflict ids for a quick "is this block in trouble" lookup. */
export function conflictsByBlock(all: Conflict[]): Map<string, Conflict[]> {
  const map = new Map<string, Conflict[]>();
  for (const conflict of all) {
    for (const id of conflict.blockIds) {
      const group = map.get(id);
      if (group) group.push(conflict);
      else map.set(id, [conflict]);
    }
  }
  return map;
}
