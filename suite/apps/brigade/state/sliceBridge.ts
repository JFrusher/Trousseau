import { guestName, readCrew, readGuests } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { parseDay } from "../core/import/day";
import { emptyDoc } from "../core/model/defaults";
import type { BrigadeDoc } from "../core/model/types";

/**
 * Where Brigade's autosave actually lands, and where its day comes from.
 *
 * Brigade was a standalone app that owned a localStorage key and got its day by
 * having you export a `.day.json` out of Cadence and drop it on the window.
 * Both halves change here, and the second is the interesting one.
 *
 * The crew — teams, people, jobs — goes into the shared wedding's `crew` slice,
 * which is Brigade's to own. The day does not: it belongs to Cadence, which
 * publishes the resolved version into the `day` slice on every edit. So instead
 * of a file the user has to remember to re-export, Brigade reads that slice and
 * the day is simply current. If a ceremony moves by ten minutes, the job sheets
 * say so without anyone doing anything.
 *
 * That works without new parsing because the published slice is the same
 * `kind: "cadence.day"` payload the export always was — so Brigade's own
 * importer reads it unchanged, orphan detection and all. A job whose block has
 * been deleted in Cadence is still spotted here, by the code that always did it.
 */

/** The crew and the day as Brigade wants them, from the shared wedding. */
export function readSlice(): BrigadeDoc {
  const { doc } = useTrousseauStore.getState();
  const crew = readCrew(doc);
  const base = emptyDoc();

  // Through Brigade's own importer rather than a second reader kept in step by
  // hand. It returns an error for a day that is not there yet, which is the
  // ordinary state of a new wedding, so that case is simply "no day".
  const parsed = parseDay(JSON.stringify(doc.day ?? {}));

  /**
   * A crew member who is also a guest is named by the guest list.
   *
   * The link is what makes "entered once" true rather than merely intended: a
   * name corrected on the guest list is corrected on the job sheets, and the
   * two cannot drift into disagreeing about how someone spells their own name.
   * Somebody linked to a guest who has since been deleted keeps the name they
   * had, which is better than a job sheet that suddenly reads "Someone".
   */
  const guests = readGuests(doc);
  const people = crew.people.map((person) => {
    if (!person.guestId) return person;
    const guest = guests[person.guestId];
    return guest ? { ...person, name: guestName(guest) || person.name } : person;
  });

  return {
    schemaVersion: base.schemaVersion,
    appVersion: base.appVersion,
    day: parsed.day ?? null,
    teams: crew.teams,
    people,
    jobs: crew.jobs,
  };
}

/**
 * The crew only. The day is Cadence's, and writing a copy of it back here would
 * create a second version of the timings that could disagree with the first.
 */
export function writeSlice(doc: BrigadeDoc): void {
  useTrousseauStore
    .getState()
    .setSlice(
      "crew",
      { teams: doc.teams, people: doc.people, jobs: doc.jobs },
      { label: "the crew", silent: true },
    );
}
