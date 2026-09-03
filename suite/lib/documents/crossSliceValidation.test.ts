import { describe, expect, it } from "vitest";
import { checkCrossSlice } from "./crossSliceValidation";

const withTable = (table: unknown, guests: Array<Record<string, unknown>>) => ({
  event: { date: "2026-06-20" },
  day: null,
  sources: {
    tableaux: {
      meta: { date: "2026-06-20" },
      guests: Object.fromEntries(guests.map((g) => [g.id as string, g])),
      tables: { [(table as { id: string }).id]: table },
    },
  },
});

const guest = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  fullName: id,
  rsvpStatus: "confirmed",
  dietaryRaw: "No",
  ...extra,
});

describe("seat slots", () => {
  it("does not treat an empty seat as a missing guest", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null, null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });

  it("still catches a guest id that does not exist", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["ghost", null] },
      [],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("ghost")]);
  });

  it("catches the same guest seated twice at one table", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("twice")]);
  });

  it("catches one seat holding two people", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g2"] },
      [
        guest("g1", { assignedTableId: "t1", assignedSeatId: "s1" }),
        guest("g2", { assignedTableId: "t1", assignedSeatId: "s1" }),
      ],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("assigned to both")]);
  });

  it("catches a table over its capacity, counting only filled seats", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2", null] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("has 1 seats")]);
  });

  it("catches a guest and their table disagreeing", () => {
    const doc = withTable({ id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [null] }, [
      guest("g1", { assignedTableId: "t1" }),
    ]);
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });
});

describe("lanes", () => {
  const day = (lanes: string[], blocks: Array<Record<string, unknown>>) => ({
    event: { date: "2026-06-20" },
    sources: {},
    day: { day: { date: "2026-06-20" }, lanes, blocks },
  });

  it("accepts a block whose lane is named by string", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Main day" }]);
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });

  it("catches a block in a lane that does not exist", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Transport" }]);
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("Transport")]);
  });
});

describe("the event date", () => {
  it("fails when two slices claim different dates", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-09-12" } } },
    };
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("2 different dates")]);
  });

  it("passes when every slice agrees", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-06-20" } } },
    };
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });
});

describe("the suite's own slices", () => {
  const asSlices = (table: unknown, guests: Array<Record<string, unknown>>) => ({
    event: { date: "2026-06-20" },
    day: null,
    guests: Object.fromEntries(guests.map((g) => [g.id as string, g])),
    seating: { tables: { [(table as { id: string }).id]: table } },
    sources: {},
  });

  it("checks the slices the suite writes, not only sources.tableaux", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.facts).toContainEqual(expect.stringContaining("(slices)"));
  });

  it("catches a guest and their table disagreeing, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });

  it("catches a table over its own capacity, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2"] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("but has 1 seats")]);
  });

  it("still reads a pre-suite bundle that only has sources.tableaux", () => {
    const doc = withTable({ id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1"] }, [
      guest("g1", { assignedTableId: "t1" }),
    ]);
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.facts).toContainEqual(expect.stringContaining("(sources.tableaux)"));
  });
});

describe("warnings do not block", () => {
  it("an unseated confirmed guest is a warning, not an error", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: {},
      guests: { g1: guest("g1") },
      seating: { tables: {} },
    };
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("no table")]);
  });
});
