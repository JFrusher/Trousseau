import { describe, expect, it } from "vitest";
import { check } from "./validate-wedding.mjs";

/** A trousseau carrying one Tableaux table and the guests sitting at it. */
const withTable = (table, guests) => ({
  event: { date: "2026-06-20" },
  day: null,
  sources: {
    tableaux: {
      meta: { date: "2026-06-20" },
      guests: Object.fromEntries(guests.map((g) => [g.id, g])),
      tables: { [table.id]: table },
    },
  },
});

const guest = (id, extra = {}) => ({
  id,
  fullName: id,
  rsvpStatus: "confirmed",
  dietaryRaw: "No",
  ...extra,
});

describe("seat slots", () => {
  // The first bug this validator had: it read every empty seat as a missing
  // guest, because in seat mode assignedGuestIds is positional and null-padded.
  it("does not treat an empty seat as a missing guest", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null, null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(check(doc).errors).toEqual([]);
  });

  it("still catches a guest id that does not exist", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["ghost", null] },
      [],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("ghost")]);
  });

  it("catches the same guest seated twice at one table", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("twice")]);
  });

  it("catches one seat holding two people", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g2"] },
      [
        guest("g1", { assignedTableId: "t1", assignedSeatId: "s1" }),
        guest("g2", { assignedTableId: "t1", assignedSeatId: "s1" }),
      ],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("assigned to both")]);
  });

  it("catches a table over its capacity, counting only filled seats", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2", null] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("has 1 seats")]);
  });

  it("catches a guest and their table disagreeing", () => {
    const doc = withTable({ id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [null] }, [
      guest("g1", { assignedTableId: "t1" }),
    ]);
    expect(check(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });
});

describe("lanes", () => {
  // The second bug: lanes were read as objects with an .id, but Cadence writes
  // plain strings, so every block looked like it sat in a lane that did not exist.
  const day = (lanes, blocks) => ({
    event: { date: "2026-06-20" },
    sources: {},
    day: { day: { date: "2026-06-20" }, lanes, blocks },
  });

  it("accepts a block whose lane is named by string", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Main day" }]);
    expect(check(doc).errors).toEqual([]);
  });

  it("catches a block in a lane that does not exist", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Transport" }]);
    expect(check(doc).errors).toEqual([expect.stringContaining("Transport")]);
  });
});

describe("the event date", () => {
  it("fails when two slices claim different dates", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-09-12" } } },
    };
    expect(check(doc).errors).toEqual([expect.stringContaining("2 different dates")]);
  });

  it("passes when every slice agrees", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-06-20" } } },
    };
    expect(check(doc).errors).toEqual([]);
  });
});

describe("the suite's own slices", () => {
  /** The same wedding, published as `guests` and `seating` rather than sources. */
  const asSlices = (table, guests) => ({
    event: { date: "2026-06-20" },
    day: null,
    guests: Object.fromEntries(guests.map((g) => [g.id, g])),
    seating: { tables: { [table.id]: table } },
    sources: {},
  });

  it("checks the slices the suite writes, not only sources.tableaux", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    const result = check(doc);
    expect(result.errors).toEqual([]);
    // Proof it looked, rather than finding nothing because it read nothing.
    expect(result.facts).toContainEqual(expect.stringContaining("(slices)"));
  });

  it("catches a guest and their table disagreeing, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });

  it("catches a table over its own capacity, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2"] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(check(doc).errors).toEqual([expect.stringContaining("but has 1 seats")]);
  });

  it("still reads a pre-suite bundle that only has sources.tableaux", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1"] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    const result = check(doc);
    expect(result.errors).toEqual([]);
    expect(result.facts).toContainEqual(expect.stringContaining("(sources.tableaux)"));
  });
});

describe("shots slice", () => {
  const base = { event: { date: "2026-06-20" }, day: null, guests: {}, seating: {} };

  it("catches a shot member naming a guest who does not exist", () => {
    const doc = {
      ...base,
      shots: {
        cast: {},
        sections: [{ id: "s1", name: "Family", shots: [{ id: "sh1", label: "x", members: [{ kind: "guest", ref: "ghost" }] }] }],
      },
    };
    expect(check(doc).errors).toEqual([expect.stringContaining("ghost")]);
  });

  it("catches a cast role naming a guest who does not exist", () => {
    const doc = { ...base, shots: { cast: { bride: ["ghost"] }, sections: [] } };
    expect(check(doc).errors).toEqual([expect.stringContaining("bride")]);
  });

  it("warns on a declined guest in a shot, without failing", () => {
    const doc = {
      ...base,
      guests: { g1: { id: "g1", rsvpStatus: "declined" } },
      shots: {
        cast: {},
        sections: [{ id: "s1", name: "Family", shots: [{ id: "sh1", label: "x", members: [{ kind: "guest", ref: "g1" }] }] }],
      },
    };
    const result = check(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("declined")]);
  });

  it("warns on an empty section and an empty shot", () => {
    const doc = {
      ...base,
      shots: {
        cast: {},
        sections: [
          { id: "s1", name: "Empty section", shots: [] },
          { id: "s2", name: "Has one", shots: [{ id: "sh1", label: "", members: [] }] },
        ],
      },
    };
    const warnings = check(doc).warnings;
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("nobody in it"), expect.stringContaining("nothing in them")]),
    );
  });
});
