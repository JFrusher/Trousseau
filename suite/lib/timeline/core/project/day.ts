import { APP_VERSION } from "../model/defaults";
import { usedTags } from "../model/tags";
import { isMoment, type TimelineDoc } from "../model/types";
import { resolve } from "../schedule/resolve";
import { slugFor } from "./file";

export const DAY_EXTENSION = ".day.json";

/** The export format's own version. It moves when this shape changes, and is
 * deliberately not the document's `schemaVersion`: a reader of the export does
 * not care how the project file is stored. */
export const DAY_VERSION = 1;

export interface DayBlock {
  id: string;
  label: string;
  lane: string;
  location: string;
  notes: string;
  tags: string[];
  startMin: number;
  /** End of the block's own length, buffer excluded. */
  contentEndMin: number;
  /** End including the contingency buffer. */
  endMin: number;
  anchored: boolean;
  /** No length at all: a point on the clock. */
  moment: boolean;
}

export interface DayTeam {
  tag: string;
  displayName: string;
  phone: string;
  arrivalMin: number | null;
  notes: string;
}

/**
 * The day with its clock times already worked out, for another tool to read.
 *
 * A `.cadence.json` holds anchors, gaps and squeeze floors — knowing when
 * anything actually happens means running the resolver. Rather than have a
 * second application reimplement the one load-bearing function in this
 * codebase, Cadence hands out the answer. Times stay integer minutes from the
 * day's 00:00, as everywhere inside the document; formatting is the reader's
 * business.
 */
export interface ResolvedDay {
  /** So a reader can refuse the wrong file politely rather than by exception. */
  kind: "cadence.day";
  version: number;
  appVersion: string;
  day: {
    date: string;
    coupleNames: string;
    venueName: string;
    curfewMin: number;
    utcOffsetMin: number;
  };
  lanes: string[];
  blocks: DayBlock[];
  /** Every tag in use, with whatever detail has been recorded against it. */
  teams: DayTeam[];
}

export function resolvedDay(doc: TimelineDoc): ResolvedDay {
  const positions = new Map(resolve(doc).map((entry) => [entry.id, entry]));

  // Every block, not only the ones on a printed piece: what a jobs tool shows
  // is its decision, and a block left off the run-sheet still has work in it.
  const blocks = doc.blocks.map((block): DayBlock => {
    const at = positions.get(block.id);
    const startMin = at?.startMin ?? 0;
    return {
      id: block.id,
      label: block.label,
      lane: block.lane,
      location: block.location,
      notes: block.notes,
      tags: [...block.tags],
      startMin,
      contentEndMin: at?.contentEndMin ?? startMin + block.durationMin,
      endMin: at?.endMin ?? startMin + block.durationMin + block.bufferMin,
      anchored: block.anchorMin !== null,
      moment: isMoment(block),
    };
  });

  const teams = usedTags(doc).map(({ tag, detail }): DayTeam => ({
    tag,
    displayName: detail?.displayName ?? "",
    phone: detail?.phone ?? "",
    arrivalMin: detail?.arrivalMin ?? null,
    notes: detail?.notes ?? "",
  }));

  return {
    kind: "cadence.day",
    version: DAY_VERSION,
    appVersion: APP_VERSION,
    day: {
      date: doc.day.date,
      coupleNames: doc.day.coupleNames,
      venueName: doc.day.venueName,
      curfewMin: doc.day.curfewMin,
      utcOffsetMin: doc.day.utcOffsetMin,
    },
    lanes: [...doc.lanes],
    blocks,
    teams,
  };
}

export function serialiseDay(doc: TimelineDoc): string {
  return JSON.stringify(resolvedDay(doc), null, 2) + "\n";
}

/** `charis-and-jacob.day.json`, or a sensible fallback. */
export function suggestedDayFilename(doc: TimelineDoc): string {
  return `${slugFor(doc) || "cadence-day"}${DAY_EXTENSION}`;
}
