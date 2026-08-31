import { describe, expect, it } from "vitest";
import { emptyTrousseau, migrate } from "@jfrusher/trousseau";
import { readiness } from "./readiness";

/**
 * These only fire on the gaps between tools, so what is worth holding is that
 * they stay quiet about anything a single tool already reports — and that they
 * are not so eager they fire on a wedding nobody has started yet.
 */

const wedding = (raw: Record<string, unknown>) => {
  const full = { ...emptyTrousseau(), ...raw };
  return readiness(migrate(full), full);
};

const ids = (raw: Record<string, unknown>) => wedding(raw).map((item) => item.id);

const GUESTS = {
  g1: { id: "g1", firstName: "Charis", lastName: "Smith", assignedTableId: "t1" },
};
const TABLES = { seating: { tables: { t1: { id: "t1", label: "Table 1" } } } };

describe("what is left to do", () => {
  it("asks for a guest list first, and says nothing else", () => {
    // A blank wedding is not a wedding with eight problems.
    expect(ids({})).toEqual(["no-guests"]);
  });

  it("stays quiet on a wedding with nothing wrong", () => {
    expect(ids({ guests: GUESTS, ...TABLES })).toEqual([]);
  });

  it("does not mention unseated guests before there are any tables", () => {
    // Nobody is seated on the day the guest list arrives, and saying so then is
    // just restating that the work has not been done yet.
    expect(ids({ guests: { g1: { id: "g1", firstName: "Charis" } } })).toEqual([]);
  });

  describe("place cards against the room", () => {
    const design = (extra: Record<string, unknown>) => ({
      guests: GUESTS,
      ...TABLES,
      stationery: { version: 1, rows: [{}], template: { elements: [] }, ...extra },
    });

    it("objects when the cards come from a file rather than the room", () => {
      expect(ids(design({ fileName: "guests.csv" }))).toContain("cards-from-file");
    });

    it("says nothing when they come from the room", () => {
      expect(ids(design({ fileName: "the room" }))).not.toContain("cards-from-file");
    });

    it("notices a dietary requirement the card cannot show", () => {
      expect(
        ids({
          guests: { g1: { ...GUESTS.g1, dietary: "coeliac" } },
          ...TABLES,
          stationery: { version: 1, fileName: "the room", rows: [{}], template: { elements: [] } },
        }),
      ).toContain("dietary-unprinted");
    });

    it("is satisfied once the card binds the dietary column", () => {
      expect(
        ids({
          guests: { g1: { ...GUESTS.g1, dietary: "coeliac" } },
          ...TABLES,
          stationery: {
            version: 1,
            fileName: "the room",
            rows: [{}],
            template: { elements: [{ text: "{{Name}} · {{Dietary}}" }] },
          },
        }),
      ).not.toContain("dietary-unprinted");
    });
  });

  describe("the day against the room", () => {
    const day = (locations: string[], spaces: unknown[]) => ({
      guests: GUESTS,
      seating: { tables: TABLES.seating.tables, room: { spaces } },
      timeline: {
        blocks: locations.map((location, i) => ({ id: `b${i}`, label: `Block ${i}`, location })),
      },
    });

    const BARN = [{ id: "s1", label: "Barn" }];

    it("notices the odd one out once the room's names are in use", () => {
      expect(ids(day(["Barn", "Orangery"], BARN))).toContain("blocks-off-plan");
    });

    it("matches a place however it was capitalised or spaced", () => {
      expect(ids(day(["barn "], BARN))).not.toContain("blocks-off-plan");
    });

    it("says nothing when the day is described in its own words", () => {
      // Nothing here matches the room, so the day simply is not using its
      // vocabulary — which is a choice, not a mistake. A ceremony can be at a
      // church nobody will ever draw a floor plan of.
      expect(ids(day(["Orangery", "Church"], BARN))).not.toContain("blocks-off-plan");
    });

    it("holds its tongue until the room has named parts", () => {
      expect(ids(day(["Orangery"], []))).not.toContain("blocks-off-plan");
    });

    it("asks where a block happens when it does not say", () => {
      expect(ids(day([""], BARN))).toContain("blocks-unplaced");
    });
  });

  it("reports a job with nobody on it as blocking", () => {
    const found = wedding({
      guests: GUESTS,
      ...TABLES,
      crew: { jobs: [{ id: "j1", label: "Rings to the best man", personIds: [] }] },
    }).find((item) => item.id === "jobs-uncrewed");

    expect(found?.severity).toBe("blocking");
    expect(found?.href).toBe("/delegation");
  });
});
