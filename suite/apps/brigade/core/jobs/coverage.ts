import { blockFor, isOrphan, type BrigadeDoc, type Job } from "../model/types";
import { formatClock } from "../time/minutes";

export type WarningKind = "double-booked" | "nobody" | "team-only" | "orphaned";

/** Conflicts hold the printing. Advisories never do. */
export type Severity = "conflict" | "advisory";

export interface Warning {
  kind: WarningKind;
  severity: Severity;
  jobIds: string[];
  message: string;
}

interface Span {
  startMin: number;
  endMin: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * What is wrong with the assignment as it stands.
 *
 * One person cannot be in two places, so that holds the print run. Work with
 * nobody on it does not: the sheets are how the gaps get filled, and a tool
 * that refuses to print until every job has a name is a tool nobody can use
 * before the crew is confirmed.
 */
export function coverage(doc: BrigadeDoc): Warning[] {
  const found: Warning[] = [];

  for (const job of doc.jobs) {
    if (isOrphan(doc, job)) {
      found.push({
        kind: "orphaned",
        severity: "conflict",
        jobIds: [job.id],
        message: `${job.label} hangs off a block the day no longer has. Move it or delete it.`,
      });
      continue;
    }

    if (job.personIds.length > 0) continue;
    found.push(
      job.teamId === null
        ? {
            kind: "nobody",
            severity: "advisory",
            jobIds: [job.id],
            message: `${job.label} has nobody on it.`,
          }
        : {
            kind: "team-only",
            severity: "advisory",
            jobIds: [job.id],
            message: `${job.label} is on a team but nobody by name.`,
          },
    );
  }

  found.push(...doubleBookings(doc));
  return found;
}

interface Held extends Span {
  job: Job;
  blockId: string;
  moment: boolean;
}

/**
 * The same person on two jobs whose blocks run at the same time.
 *
 * Two jobs inside one block are not that: laying the covers and lighting the
 * candles during the same turnaround is one person's ordinary working half
 * hour, and how they order it is their business. And a job on a moment is a
 * job that takes an instant — worth mentioning when it lands inside other
 * work, never worth holding the print run over.
 */
function doubleBookings(doc: BrigadeDoc): Warning[] {
  const byPerson = new Map<string, Held[]>();

  for (const job of doc.jobs) {
    const block = blockFor(doc, job);
    if (!block) continue;
    for (const personId of job.personIds) {
      const group = byPerson.get(personId) ?? [];
      group.push({
        job,
        blockId: block.id,
        moment: block.moment,
        startMin: block.startMin,
        endMin: block.endMin,
      });
      byPerson.set(personId, group);
    }
  }

  const found: Warning[] = [];
  for (const [personId, entries] of byPerson) {
    const name = doc.people.find((person) => person.id === personId)?.name ?? "Someone";
    const sorted = [...entries].sort((a, b) => a.startMin - b.startMin);

    for (let i = 0; i < sorted.length; i += 1) {
      for (let k = i + 1; k < sorted.length; k += 1) {
        const first = sorted[i];
        const second = sorted[k];
        if (!first || !second) continue;
        // Sorted by start, so once one is clear of the first, so is the rest.
        if (second.startMin >= first.endMin) break;
        if (first.blockId === second.blockId) continue;
        if (!overlaps(first, second)) continue;

        const instant = first.moment || second.moment;
        found.push({
          kind: "double-booked",
          severity: instant ? "advisory" : "conflict",
          jobIds: [first.job.id, second.job.id],
          message: instant
            ? `${name} is on ${first.job.label} and ${second.job.label} at ${formatClock(
                Math.max(first.startMin, second.startMin),
              )}. One of them takes an instant, so it may well be fine.`
            : `${name} is on ${first.job.label} and ${second.job.label} at ${formatClock(
                Math.max(first.startMin, second.startMin),
              )}.`,
        });
      }
    }
  }
  return found;
}

export function blocking(all: Warning[]): Warning[] {
  return all.filter((warning) => warning.severity === "conflict");
}

/** Warnings keyed by job, for a quick "is this one in trouble" lookup. */
export function warningsByJob(all: Warning[]): Map<string, Warning[]> {
  const map = new Map<string, Warning[]>();
  for (const warning of all) {
    for (const id of warning.jobIds) {
      const group = map.get(id);
      if (group) group.push(warning);
      else map.set(id, [warning]);
    }
  }
  return map;
}
