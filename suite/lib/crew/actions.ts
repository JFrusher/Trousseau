import { newId } from "@/lib/model/ids";
import type { Crew, Job, JobStatus, Person, Team } from "@/lib/model/types";
import type { Timeline } from "@/lib/model/timeline";

/**
 * The work of the day, and the hands doing it.
 *
 * A job has no time of its own: it happens when its block happens and moves
 * when the block moves. That is the whole reason it stores a `blockId` and
 * nothing else about when — a job carrying its own clock time would drift out
 * of step with the timeline the first time anything moved.
 */

export function addTeam(crew: Crew, name: string, tag: string | null = null): Crew {
  const clean = name.trim();
  if (!clean) return crew;
  const team: Team = { id: newId("team"), tag, name: clean, phone: "", notes: "" };
  return { ...crew, teams: [...crew.teams, team] };
}

export function addPerson(crew: Crew, name: string, teamId: string | null): Crew {
  const clean = name.trim();
  if (!clean) return crew;
  const person: Person = { id: newId("p"), name: clean, teamId, phone: "", notes: "" };
  return { ...crew, people: [...crew.people, person] };
}

export function addJob(crew: Crew, blockId: string, label = "New job"): Crew {
  const job: Job = {
    id: newId("j"),
    blockId,
    label,
    notes: "",
    teamId: null,
    personIds: [],
    status: "todo",
  };
  return { ...crew, jobs: [...crew.jobs, job] };
}

export const patchJob = (crew: Crew, id: string, patch: Partial<Job>): Crew => ({
  ...crew,
  jobs: crew.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
});

export const patchPerson = (crew: Crew, id: string, patch: Partial<Person>): Crew => ({
  ...crew,
  people: crew.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});

export const patchTeam = (crew: Crew, id: string, patch: Partial<Team>): Crew => ({
  ...crew,
  teams: crew.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)),
});

export const removeJob = (crew: Crew, id: string): Crew => ({
  ...crew,
  jobs: crew.jobs.filter((j) => j.id !== id),
});

/** Removing a person takes them off every job too, so nothing points at nobody. */
export const removePerson = (crew: Crew, id: string): Crew => ({
  ...crew,
  people: crew.people.filter((p) => p.id !== id),
  jobs: crew.jobs.map((j) =>
    j.personIds.includes(id) ? { ...j, personIds: j.personIds.filter((p) => p !== id) } : j,
  ),
});

export function toggleAssignment(crew: Crew, jobId: string, personId: string): Crew {
  const job = crew.jobs.find((j) => j.id === jobId);
  if (!job) return crew;
  const personIds = job.personIds.includes(personId)
    ? job.personIds.filter((p) => p !== personId)
    : [...job.personIds, personId];
  return patchJob(crew, jobId, { personIds });
}

export const setJobStatus = (crew: Crew, jobId: string, status: JobStatus): Crew =>
  patchJob(crew, jobId, { status });

/**
 * Seed teams from the timeline's supplier tags.
 *
 * Matched on `tag`, so a team the user has since renamed is recognised as the
 * one it already is rather than added again. Only genuinely new tags produce a
 * team, and nothing existing is touched.
 */
export function seedTeamsFromTags(crew: Crew, timeline: Timeline): Crew {
  const known = new Set(crew.teams.map((t) => t.tag).filter((t): t is string => t !== null));
  const detail = new Map(timeline.tagDetails.map((d) => [d.tag, d]));

  const added: Team[] = [];
  for (const block of timeline.blocks) {
    for (const tag of block.tags) {
      if (known.has(tag)) continue;
      known.add(tag);
      const d = detail.get(tag);
      added.push({
        id: newId("team"),
        tag,
        name: d?.displayName || tag,
        phone: d?.phone ?? "",
        notes: d?.notes ?? "",
      });
    }
  }

  return added.length === 0 ? crew : { ...crew, teams: [...crew.teams, ...added] };
}

/**
 * A job whose block is no longer in the day.
 *
 * Derived, never stored: the day is what changes, and a stored flag would go
 * stale the moment it did. Orphans are kept and flagged rather than dropped —
 * losing somebody's work because a block was renamed away is not recoverable.
 */
export const orphanJobs = (crew: Crew, blockIds: ReadonlySet<string>): Job[] =>
  crew.jobs.filter((j) => !blockIds.has(j.blockId));

/** What to print against a job: the named people, or the team, or nobody. */
export function assigneeNames(crew: Crew, job: Job): string[] {
  const named = job.personIds
    .map((id) => crew.people.find((p) => p.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (named.length > 0) return named;
  const team = crew.teams.find((t) => t.id === job.teamId);
  return team ? [team.name] : [];
}

export interface PersonSheet {
  person: Person;
  teamName: string | null;
  jobs: Job[];
}

/**
 * One sheet per person, in the order their jobs happen.
 *
 * `order` maps a block id to its start time — passed in rather than looked up,
 * because the clock belongs to the resolver and this module must not have a
 * second opinion about when anything is.
 */
export function personSheets(crew: Crew, order: ReadonlyMap<string, number>): PersonSheet[] {
  return crew.people
    .map((person) => ({
      person,
      teamName: crew.teams.find((t) => t.id === person.teamId)?.name ?? null,
      jobs: crew.jobs
        .filter((j) => j.personIds.includes(person.id))
        .sort(
          (a, b) =>
            (order.get(a.blockId) ?? Infinity) - (order.get(b.blockId) ?? Infinity) ||
            a.label.localeCompare(b.label),
        ),
    }))
    .filter((sheet) => sheet.jobs.length > 0)
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
}
