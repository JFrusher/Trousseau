/** The Brigade document model. Jobs, the people who do them, and the day they hang off. */

/**
 * The day as Cadence exported it: already resolved to clock times, and never
 * edited here. Brigade owns the work, Cadence owns the clock.
 */
export interface DayBlock {
  id: string;
  label: string;
  lane: string;
  location: string;
  notes: string;
  tags: string[];
  startMin: number;
  contentEndMin: number;
  endMin: number;
  anchored: boolean;
  moment: boolean;
}

export interface ImportedDay {
  version: number;
  /** The version of Cadence that wrote the file. Shown, never acted on. */
  appVersion: string;
  date: string;
  coupleNames: string;
  venueName: string;
  curfewMin: number;
  utcOffsetMin: number;
  lanes: string[];
  blocks: DayBlock[];
}

/**
 * A supplier or a group: the caterer, the venue, the family. Seeded from the
 * day's tags on import, then the user's to rename, merge or delete — `tag`
 * only records where it came from, so a later import can tell a genuinely new
 * supplier from one that has since been renamed.
 */
export interface Team {
  id: string;
  tag: string | null;
  name: string;
  phone: string;
  notes: string;
}

export interface Person {
  id: string;
  name: string;
  teamId: string | null;
  phone: string;
  notes: string;
  /**
   * The guest this is, when it is one.
   *
   * A best man is on the guest list and is also holding the rings; a bridesmaid
   * is at table two and is also getting the bride down the aisle. Without this
   * they get typed twice and one copy goes stale. Linked, the name is read from
   * the guest list, so a spelling corrected there is corrected here.
   *
   * Null for the people who are only crew — the florist, the band, the venue
   * coordinator — who are not guests and should not be added to the list to
   * become one.
   */
  guestId: string | null;
}

/**
 * One piece of work, hung off a block of the day. It has no time of its own:
 * it happens when its block happens, and moves when the block moves.
 */
export interface Job {
  id: string;
  /** The only link back to Cadence. */
  blockId: string;
  label: string;
  notes: string;
  /** Who owns it when no name is on it yet. */
  teamId: string | null;
  /** More than one, because some jobs take more than one pair of hands. */
  personIds: string[];
}

export interface BrigadeDoc {
  schemaVersion: number;
  appVersion: string;
  day: ImportedDay | null;
  teams: Team[];
  people: Person[];
  jobs: Job[];
}

/**
 * A job whose block is no longer in the day. Derived, never stored: the day is
 * what changes, and a stored flag would go stale the moment it did.
 */
export function isOrphan(doc: BrigadeDoc, job: Job): boolean {
  return !doc.day?.blocks.some((block) => block.id === job.blockId);
}

/** The block a job hangs off, or null if the day no longer has it. */
export function blockFor(doc: BrigadeDoc, job: Job): DayBlock | null {
  return doc.day?.blocks.find((block) => block.id === job.blockId) ?? null;
}

/** What to print for a job's owner: the named people, or the team, or nobody. */
export function assigneeNames(doc: BrigadeDoc, job: Job): string[] {
  const named = job.personIds
    .map((id) => doc.people.find((person) => person.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (named.length > 0) return named;

  const team = doc.teams.find((entry) => entry.id === job.teamId);
  return team ? [team.name] : [];
}
