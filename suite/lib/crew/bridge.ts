import type { Trousseau } from "@jfrusher/trousseau";
import { cached, readCrew, readTimeline, resolvedDay } from "@/lib/model/slices";
import type { Crew } from "@/lib/model/types";
import type { BrigadeDoc, DayBlock, ImportedDay } from "./core/model/types";

/**
 * Brigade's document, assembled from the suite's slices.
 *
 * Brigade was a separate app: it imported a resolved `.day.json` from Cadence
 * and held its own copy. Here the day is next door, so there is no import and
 * no copy — the day is built on demand from the timeline slice, and the crew
 * slice supplies only what Brigade actually owns.
 *
 * That removes Brigade's whole re-import-and-reconcile problem for the ordinary
 * case: a block that moves takes its jobs with it, because there was never a
 * second record of when the block happens. `reconcile` is still ported, because
 * a restored backup can still carry jobs pointing at blocks the day has lost.
 */
export function brigadeDoc(doc: Trousseau): BrigadeDoc {
  return cached(doc, "brigade", () => buildBrigadeDoc(doc));
}

function buildBrigadeDoc(doc: Trousseau): BrigadeDoc {
  const crew = readCrew(doc);
  const timeline = readTimeline(doc);
  const placed = new Map(resolvedDay(doc).map((entry) => [entry.id, entry]));

  const blocks: DayBlock[] = timeline.blocks.flatMap((block) => {
    const entry = placed.get(block.id);
    if (!entry) return [];
    return [
      {
        id: block.id,
        label: block.label,
        lane: block.lane,
        location: block.location,
        notes: block.notes,
        tags: block.tags,
        startMin: entry.startMin,
        contentEndMin: entry.contentEndMin,
        endMin: entry.endMin,
        anchored: entry.anchored,
        moment: block.durationMin <= 0,
      },
    ];
  });

  const day: ImportedDay = {
    version: 1,
    appVersion: "suite",
    date: timeline.day.date,
    coupleNames: timeline.day.coupleNames,
    venueName: timeline.day.venueName,
    curfewMin: timeline.day.curfewMin,
    utcOffsetMin: timeline.day.utcOffsetMin,
    lanes: timeline.lanes,
    blocks,
  };

  return {
    schemaVersion: 1,
    appVersion: "suite",
    day,
    teams: crew.teams,
    people: crew.people,
    // Brigade's `Job` has no kanban column; the suite's does. Extra fields ride
    // along harmlessly — nothing in Brigade's core reads them.
    jobs: crew.jobs,
  };
}

/** The crew slice, taken back out of a Brigade document. */
export function crewFrom(doc: BrigadeDoc, previous: Crew): Crew {
  return {
    teams: doc.teams,
    people: doc.people,
    jobs: doc.jobs.map((job) => {
      const before = previous.jobs.find((j) => j.id === job.id);
      return {
        ...job,
        // The column the user put it in survives a round trip through Brigade's
        // model, which does not know the board exists.
        status: before?.status ?? "todo",
      };
    }),
  };
}
