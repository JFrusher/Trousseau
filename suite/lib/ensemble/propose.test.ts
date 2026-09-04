import { describe, expect, it } from "vitest";
import type { Family, Guest, NamedGroup, Seating } from "@/lib/model/types";
import { propose } from "./propose";

const guest = (id: string, extra: Partial<Guest> = {}): Guest => ({
  id,
  firstName: id,
  lastName: "",
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
  ...extra,
});

const seating = (extra: Partial<Seating> = {}): Seating => ({
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
  ...extra,
});

describe("propose: template", () => {
  it("produces the five classic sections, every shot built from role members only", () => {
    const sections = propose([], {}, seating(), "template");
    expect(sections.map((s) => s.name)).toEqual([
      "The couple",
      "Bride's family",
      "Groom's family",
      "Both families",
      "Wedding party",
    ]);
    for (const section of sections) {
      for (const shot of section.shots) {
        expect(shot.members.every((m) => m.kind === "role")).toBe(true);
      }
    }
    expect(sections.flatMap((s) => s.shots).length).toBeGreaterThan(5);
  });

  it("is idempotent: proposing twice adds nothing the second time", () => {
    const first = propose([], {}, seating(), "template");
    const second = propose(first, {}, seating(), "template");
    expect(second).toEqual(first);
  });
});

describe("propose: generate", () => {
  it("adds one shot per family, sided by majority Guest.side", () => {
    const guests: Record<string, Guest> = {
      g1: guest("g1", { side: "bride" }),
      g2: guest("g2", { side: "bride" }),
    };
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "The Hartleys", memberIds: ["g1", "g2"] } };
    const sections = propose([], guests, seating({ families }), "generate");
    const bridesFamily = sections.find((s) => s.name === "Bride's family")!;
    expect(bridesFamily.shots.some((s) => s.label === "The Hartleys")).toBe(true);
  });

  it("adds one shot per named group, groups and subgroups both", () => {
    const guests: Record<string, Guest> = { g1: guest("g1", { subgroupId: "grp1", side: "groom" }) };
    const subgroups: Record<string, NamedGroup> = { grp1: { id: "grp1", name: "University friends" } };
    const sections = propose([], guests, seating({ subgroups }), "generate");
    const groomsFamily = sections.find((s) => s.name === "Groom's family")!;
    expect(groomsFamily.shots.some((s) => s.label === "University friends")).toBe(true);
  });

  it("files an unsided family under Both families", () => {
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "Neighbours", memberIds: [] } };
    const sections = propose([], {}, seating({ families }), "generate");
    const both = sections.find((s) => s.name === "Both families")!;
    expect(both.shots.some((s) => s.label === "Neighbours")).toBe(true);
  });

  it("is idempotent: generating twice adds each family once", () => {
    const guests: Record<string, Guest> = { g1: guest("g1", { side: "bride" }) };
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "The Hartleys", memberIds: ["g1"] } };
    const first = propose([], guests, seating({ families }), "generate");
    const second = propose(first, guests, seating({ families }), "generate");
    expect(second).toEqual(first);
  });
});
