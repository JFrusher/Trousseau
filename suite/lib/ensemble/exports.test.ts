import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/data/csv";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { shotListCsv } from "./exports";

const guest = (id: string, firstName: string, lastName: string): Guest => ({
  id,
  firstName,
  lastName,
  email: "",
  rsvpStatus: "confirmed",
  dietary: "",
  entree: "",
  notes: "",
  side: "",
  groupId: null,
  subgroupId: null,
  familyId: null,
  assignedTableId: null,
  tags: [],
  plusOneOf: null,
});

const guests: Record<string, Guest> = {
  g1: guest("g1", "Charis", "Smith"),
  g2: guest("g2", "Rowan", "Hartley"),
};

const seating: Seating = {
  tables: {},
  groups: {},
  subgroups: {},
  families: {},
  zones: {},
  obstacles: {},
  constraints: [],
  snapshots: [],
  room: { widthUnits: 0, heightUnits: 0, width: 0, height: 0, backgroundColour: "", spaces: [] },
  settings: {
    defaultSeatMode: "table",
    pixelsPerUnit: 1,
    gridSnap: true,
    gridSize: 1,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: 1,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  },
};

const emptyCast: Cast = {
  bride: [],
  groom: [],
  "brides-mother": [],
  "brides-father": [],
  "grooms-mother": [],
  "grooms-father": [],
  "bridal-party": [],
  groomsmen: [],
};

describe("shotListCsv", () => {
  it("numbers shots consecutively across sections, with the resolved names", () => {
    const sections: ShotSection[] = [
      { id: "s1", name: "Bride's family", shots: [{ id: "sh1", label: "With mum", members: [{ kind: "guest", ref: "g1" }], notes: "Quick one" }] },
      { id: "s2", name: "Both families", shots: [{ id: "sh2", label: "Everyone", members: [], notes: "" }] },
    ];
    const table = parseCsv(shotListCsv(sections, guests, seating, emptyCast));
    expect(table.headers).toEqual(["Section", "No", "Shot", "People", "Notes"]);
    expect(table.rows).toEqual([
      { Section: "Bride's family", No: "1", Shot: "With mum", People: "Charis Smith", Notes: "Quick one" },
      { Section: "Both families", No: "2", Shot: "Everyone", People: "", Notes: "" },
    ]);
  });

  it("joins several people with a comma, and quotes the cell so it survives the round trip", () => {
    const sections: ShotSection[] = [
      {
        id: "s1",
        name: "The couple",
        shots: [
          {
            id: "sh1",
            label: "Both of them",
            members: [
              { kind: "guest", ref: "g1" },
              { kind: "guest", ref: "g2" },
            ],
            notes: "",
          },
        ],
      },
    ];
    const csv = shotListCsv(sections, guests, seating, emptyCast);

    // A comma inside a cell has to be quoted, or the column count is wrong.
    expect(csv).toContain('"Charis Smith, Rowan Hartley"');
    expect(parseCsv(csv).rows).toEqual([
      {
        Section: "The couple",
        No: "1",
        Shot: "Both of them",
        People: "Charis Smith, Rowan Hartley",
        Notes: "",
      },
    ]);
  });
});
