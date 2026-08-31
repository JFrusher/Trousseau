import { expect, test } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { guessMapping, rowsToGuests } from "./guestImport";
import { newGuest } from "@/lib/model/factories";

test("quoted fields, embedded newlines and CRLF all survive the parse", () => {
  const table = parseCsv(
    'First Name,Last Name,Notes\r\nCharis,"Smith","two lines\nhere"\r\nAlexander,Wright,""\r\n',
  );
  expect(table.headers).toEqual(["First Name", "Last Name", "Notes"]);
  expect(table.rows).toHaveLength(2);
  expect(table.rows[0]!["Notes"]).toBe("two lines\nhere");
});

test("an unterminated quote is refused rather than swallowing the file", () => {
  expect(() => parseCsv('Name\r\n"Charis\r\nAlexander\r\n')).toThrow(/Unterminated quote/);
});

test("duplicate headers are kept apart instead of overwriting each other", () => {
  const table = parseCsv("Notes,Notes\r\nfrom rsvp,from venue\r\n");
  expect(table.headers).toEqual(["Notes", "Notes (2)"]);
  expect(table.rows[0]).toEqual({ Notes: "from rsvp", "Notes (2)": "from venue" });
});

test("a cell that would execute as a formula is neutralised on the way out", () => {
  expect(toCsv(["Name"], [["=cmd|'/c calc'!A1"]])).toContain("'=cmd");
});

test("the PRD's own sample columns are all recognised", () => {
  const mapping = guessMapping(["First Name", "Last Name", "Table", "Dietary", "Entree"]);
  expect(mapping.firstName).toBe("First Name");
  expect(mapping.lastName).toBe("Last Name");
  expect(mapping.table).toBe("Table");
  expect(mapping.dietary).toBe("Dietary");
  expect(mapping.entree).toBe("Entree");
});

test("a name in one column is split into first and last", () => {
  const table = parseCsv("Name\r\nEleanor Vane\r\nMadonna\r\n");
  const { guests } = rowsToGuests(table, guessMapping(table.headers));
  const names = Object.values(guests).map((g) => [g.firstName, g.lastName]);
  expect(names).toContainEqual(["Eleanor", "Vane"]);
  expect(names).toContainEqual(["Madonna", ""]);
});

test("re-importing an updated list keeps the seating already done", () => {
  const seated = newGuest({
    id: "g1",
    firstName: "Charis",
    lastName: "Smith",
    assignedTableId: "t4",
  });

  const table = parseCsv("First Name,Last Name,Dietary,RSVP\r\nCharis,Smith,Vegetarian,yes\r\n");
  const { guests } = rowsToGuests(table, guessMapping(table.headers), { g1: seated });

  expect(Object.keys(guests)).toEqual(["g1"]);
  expect(guests["g1"]!.dietary).toBe("Vegetarian");
  expect(guests["g1"]!.rsvpStatus).toBe("confirmed");
  // The plan on the canvas is the truth. A CSV must never unseat anybody.
  expect(guests["g1"]!.assignedTableId).toBe("t4");
});

test("rows with no name at all are counted rather than invented", () => {
  // A wholly blank line is dropped by the parser; this row has content, just
  // nothing that names anybody — a stray note left in the spreadsheet.
  const table = parseCsv("First Name,Last Name,Notes\r\nCharis,Smith,\r\n,,ask about parking\r\n");
  const result = rowsToGuests(table, guessMapping(table.headers));
  expect(Object.keys(result.guests)).toHaveLength(1);
  expect(result.skipped).toBe(1);
});
