import { guestName, readGuests, readSeating } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import type { CsvIssue, GuestRow } from "../core/csv/parse";

/**
 * The guest list Plaque prints from, taken out of the room instead of a file.
 *
 * Plaque was a standalone app, so the only way in was a CSV you exported from
 * somewhere else. That is still how a list arrives when it comes from a
 * spreadsheet, but the usual case here is that the wedding already has one: you
 * seated the room next door, and every table number on those cards is a fact
 * this app already holds.
 *
 * Going through the file shape rather than around it is deliberate. Plaque's
 * whole design is built on columns — you bind `{{First Name}}` to a text
 * element and it prints once per row — so handing it rows is handing it
 * something it already knows exactly what to do with. Nothing in the store, the
 * template binding or the export had to learn about seating.
 *
 * The columns are the ones a card actually uses. Everything else the room holds
 * — coordinates, groups, RSVP state — would only appear as tokens nobody binds.
 */

const COLUMNS = ["First Name", "Last Name", "Name", "Table", "Dietary", "Side"] as const;

export interface RoomRows {
  headers: string[];
  rows: GuestRow[];
  issues: CsvIssue[];
  fileName: string;
}

/** Reads the wedding as it stands. Empty when nobody has been seated yet. */
export function rowsFromRoom(): RoomRows {
  const { doc } = useTrousseauStore.getState();
  const guests = readGuests(doc);
  const seating = readSeating(doc);

  const tableLabel = new Map<string, string>();
  for (const [id, table] of Object.entries(seating.tables)) {
    tableLabel.set(id, table.label || id);
  }

  const people = Object.values(guests).sort((a, b) =>
    guestName(a).localeCompare(guestName(b), "en"),
  );

  const rows: GuestRow[] = people.map((guest) => ({
    "First Name": guest.firstName,
    "Last Name": guest.lastName,
    Name: guestName(guest),
    Table: guest.assignedTableId ? (tableLabel.get(guest.assignedTableId) ?? "") : "",
    Dietary: guest.dietary,
    Side: guest.side,
  }));

  /**
   * Someone with no table gets a card with an empty table line rather than no
   * card. That is the right way round: an unseated guest is a job still to do,
   * and a card that silently went missing is how somebody arrives to no place
   * at all. Said once, as a count, rather than once per person.
   */
  const unseated = people.filter((guest) => !guest.assignedTableId).length;
  const issues: CsvIssue[] =
    unseated === 0
      ? []
      : [
          {
            // Not about any one row, so it has no row number — the same shape a
            // problem with a whole file gets.
            row: null,
            message:
              unseated === 1
                ? "One guest has no table yet, so their card has no table on it."
                : `${unseated} guests have no table yet, so their cards have no table on them.`,
          },
        ];

  return { headers: [...COLUMNS], rows, issues, fileName: "the room" };
}
