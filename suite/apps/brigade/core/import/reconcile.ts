import { newId } from "../model/ids";
import type { BrigadeDoc, ImportedDay, Team } from "../model/types";
import type { DayTeam } from "./day";

export interface ReconcileReport {
  /** Jobs whose block is no longer in the day. Kept, never dropped. */
  orphanedJobIds: string[];
  /** Blocks that are new since the last import, so nobody has put work on them. */
  newBlockIds: string[];
  /** Teams added from tags the document had not seen before. */
  addedTeamIds: string[];
}

export interface ReconcileResult {
  doc: BrigadeDoc;
  report: ReconcileReport;
}

/**
 * Lands a freshly exported day on a document that already has work on it.
 *
 * Jobs carry no times of their own — they read them through `blockId` — so a
 * block that has moved needs nothing done to it here. What this has to get
 * right is what happens to the work when the day no longer matches: a job
 * whose block has gone is kept and reported, because a deleted block is
 * usually a renamed one, and the job is the part that is hard to type again.
 */
export function reconcile(
  doc: BrigadeDoc,
  day: ImportedDay,
  suggested: DayTeam[] = [],
): ReconcileResult {
  const blockIds = new Set(day.blocks.map((block) => block.id));
  const previousIds = new Set((doc.day?.blocks ?? []).map((block) => block.id));

  // A tag the document has never seen becomes a team. One whose team has been
  // renamed, or deleted on purpose, is left exactly as the user left it: the
  // tag is where a team came from, not what it is.
  const known = new Set(doc.teams.map((team) => team.tag).filter(Boolean));
  const seen = new Set(doc.day?.blocks.flatMap((block) => block.tags) ?? []);
  const added: Team[] = suggested
    .filter((team) => !known.has(team.tag) && !seen.has(team.tag))
    .map((team) => ({
      id: newId("team"),
      tag: team.tag,
      name: team.displayName || team.tag,
      phone: team.phone,
      notes: team.notes,
    }));

  return {
    doc: { ...doc, day, teams: [...doc.teams, ...added] },
    report: {
      orphanedJobIds: doc.jobs
        .filter((job) => !blockIds.has(job.blockId))
        .map((job) => job.id),
      newBlockIds: day.blocks
        .filter((block) => !previousIds.has(block.id))
        .map((block) => block.id),
      addedTeamIds: added.map((team) => team.id),
    },
  };
}

/** A one-line account of an import, for the notice bar. */
export function describe(report: ReconcileReport, doc: BrigadeDoc): string {
  const parts = [`${doc.day?.blocks.length ?? 0} blocks`];
  if (report.addedTeamIds.length > 0) parts.push(`${report.addedTeamIds.length} new team(s)`);
  if (report.newBlockIds.length > 0) parts.push(`${report.newBlockIds.length} new block(s)`);
  if (report.orphanedJobIds.length > 0) {
    parts.push(`${report.orphanedJobIds.length} job(s) lost their block and need moving`);
  }
  return `Day imported: ${parts.join(", ")}.`;
}
