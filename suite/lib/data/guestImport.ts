import type { Guest, RsvpStatus, Side } from "@/lib/model/types";
import { newGuest } from "@/lib/model/factories";
import type { CsvTable } from "./csv";

/**
 * Turning an uploaded guest list into guests.
 *
 * The mapping is guessed, never enforced: a column the guesser misses is still
 * bindable by hand, and a list with none of these headers still imports — as
 * names and nothing else. Refusing an unfamiliar export would send the user
 * back to a spreadsheet, which is the thing this replaces.
 *
 * Patterns are Plaque's `guessMapping` and Tableaux's `csvParser` merged, since
 * between them they already covered the exports these lists arrive as.
 */

export interface FieldMapping {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  rsvp: string | null;
  dietary: string | null;
  entree: string | null;
  side: string | null;
  notes: string | null;
  table: string | null;
}

export const MAPPABLE_FIELDS: Array<{ key: keyof FieldMapping; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "rsvp", label: "RSVP" },
  { key: "dietary", label: "Dietary" },
  { key: "entree", label: "Main course" },
  { key: "side", label: "Side" },
  { key: "notes", label: "Notes" },
  { key: "table", label: "Table" },
];

/** Checked in order; the first header matching a pattern wins that field. */
const PATTERNS: Array<[keyof FieldMapping, RegExp]> = [
  // The optional "guest" prefix covers RSVP exports that label every column
  // with whose it is: "Guest First", "Guest Surname".
  ["firstName", /^(guest)?(first|firstname|forename|givenname|given|fname)$/],
  ["lastName", /^(guest)?(last|lastname|surname|familyname|family|lname)$/],
  ["fullName", /^(name|fullname|guest|guestname|displayname)$/],
  ["email", /^(email|e-?mail|mail|emailaddress)$/],
  ["rsvp", /^(rsvp|attending|attend|coming|response|status|rsvpstatus)$/],
  [
    "dietary",
    /^(dietary|diet|dietaryneeds|dietaryrequirements?|requirements|allergies|allergy|allergens|restrictions)$/,
  ],
  ["entree", /^(entree|entrée|main|maincourse|mealchoice|course|food)$/],
  ["side", /^(side|party|guestof|relation)$/],
  ["notes", /^(notes?|comment|comments|remark|remarks)$/],
  ["table", /^(table|tbl|tableno|tablenum|tablenumber|tablename|seating)$/],
];

const normalise = (header: string): string => header.toLowerCase().replace(/[^a-z0-9é]/g, "");

export function guessMapping(headers: string[]): FieldMapping {
  const guesses: FieldMapping = {
    firstName: null,
    lastName: null,
    fullName: null,
    email: null,
    rsvp: null,
    dietary: null,
    entree: null,
    side: null,
    notes: null,
    table: null,
  };

  for (const header of headers) {
    const key = normalise(header);
    for (const [field, pattern] of PATTERNS) {
      if (guesses[field] === null && pattern.test(key)) {
        guesses[field] = header;
        break;
      }
    }
  }

  return guesses;
}

const COMING = new Set([
  "yes", "y", "confirmed", "confirm", "true", "1", "attending", "coming", "accepted", "going",
]);
const NOT_COMING = new Set([
  "no", "n", "declined", "decline", "false", "0", "regrets", "not attending", "cannot",
]);

function readRsvp(value: string): RsvpStatus {
  const key = value.trim().toLowerCase();
  if (COMING.has(key)) return "confirmed";
  if (NOT_COMING.has(key)) return "declined";
  return "pending";
}

function readSide(value: string): Side {
  const key = value.trim().toLowerCase();
  if (key.startsWith("bride")) return "bride";
  if (key.startsWith("groom")) return "groom";
  if (key.startsWith("both") || key.startsWith("shared")) return "both";
  return "";
}

/** A whole name in one column: everything before the last space is the first name. */
function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: full.trim(), lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

export interface ImportResult {
  guests: Record<string, Guest>;
  /** Table names named in the CSV, in first-seen order, for the seating import. */
  tableLabels: string[];
  /** Rows that carried no name at all, and so became nobody. */
  skipped: number;
}

/**
 * Build guests from a parsed CSV.
 *
 * `existing` is merged into rather than replaced: re-importing an updated list
 * must not lose the seating already done. A guest is the same guest when the
 * name matches one already on the list, because RSVP exports rarely carry a
 * stable id and a fresh one every import would double the wedding.
 */
export function rowsToGuests(
  table: CsvTable,
  mapping: FieldMapping,
  existing: Record<string, Guest> = {},
): ImportResult {
  const byName = new Map<string, Guest>();
  for (const guest of Object.values(existing)) {
    byName.set(nameKey(guest.firstName, guest.lastName), guest);
  }

  const guests: Record<string, Guest> = { ...existing };
  const tableLabels: string[] = [];
  const seenTables = new Set<string>();
  let skipped = 0;

  const cell = (row: Record<string, string>, header: string | null): string =>
    header === null ? "" : (row[header] ?? "");

  for (const row of table.rows) {
    let firstName = cell(row, mapping.firstName);
    let lastName = cell(row, mapping.lastName);
    if (!firstName && !lastName) {
      const full = cell(row, mapping.fullName);
      if (!full) {
        skipped++;
        continue;
      }
      ({ firstName, lastName } = splitFullName(full));
    }
    if (!firstName && !lastName) {
      skipped++;
      continue;
    }

    const label = cell(row, mapping.table);
    if (label && !seenTables.has(label)) {
      seenTables.add(label);
      tableLabels.push(label);
    }

    const previous = byName.get(nameKey(firstName, lastName));
    const guest: Guest = newGuest({
      ...previous,
      firstName,
      lastName,
      email: cell(row, mapping.email) || previous?.email || "",
      rsvpStatus: mapping.rsvp ? readRsvp(cell(row, mapping.rsvp)) : (previous?.rsvpStatus ?? "pending"),
      dietary: cell(row, mapping.dietary) || previous?.dietary || "",
      entree: cell(row, mapping.entree) || previous?.entree || "",
      notes: cell(row, mapping.notes) || previous?.notes || "",
      side: mapping.side ? readSide(cell(row, mapping.side)) : (previous?.side ?? ""),
      groupId: previous?.groupId ?? null,
      subgroupId: previous?.subgroupId ?? null,
      familyId: previous?.familyId ?? null,
      // Seating is never taken from a CSV: the plan on the canvas is the truth,
      // and a re-import must not silently unseat a hundred people.
      assignedTableId: previous?.assignedTableId ?? null,
    });

    guests[guest.id] = guest;
    byName.set(nameKey(firstName, lastName), guest);
  }

  return { guests, tableLabels, skipped };
}

function nameKey(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, " ");
}
