import { describe, expect, it } from "vitest";
import type { Cast, Guest, Seating, Shot } from "@/lib/model/types";
import { emptyCast } from "@/lib/model/slices";
import { resolveShot } from "./resolve";

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

const shot = (members: Shot["members"], extra: Partial<Shot> = {}): Shot => ({
  id: "sh1",
  label: "",
  members,
  notes: "",
  ...extra,
});

describe("resolveShot: member kinds", () => {
  it("resolves a guest member by id", () => {
    const guests = { g1: guest("g1", { firstName: "Charis" }) };
    const result = resolveShot(shot([{ kind: "guest", ref: "g1" }]), guests, seating(), emptyCast());
    expect(result.people).toEqual([{ guestId: "g1", name: "Charis", rsvpStatus: "confirmed" }]);
    expect(result.problems).toEqual([]);
  });

  it("resolves a family member to all its members", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const s = seating({ families: { fam1: { id: "fam1", name: "Hartley", memberIds: ["g1", "g2"] } } });
    const result = resolveShot(shot([{ kind: "family", ref: "fam1" }]), guests, s, emptyCast());
    expect(result.people.map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("resolves a group member to every guest tagged with it, group or subgroup", () => {
    const guests = {
      g1: guest("g1", { firstName: "A", groupId: "grp1" }),
      g2: guest("g2", { firstName: "B", subgroupId: "grp1" }),
      g3: guest("g3", { firstName: "C" }),
    };
    const s = seating({ subgroups: { grp1: { id: "grp1", name: "University" } } });
    const result = resolveShot(shot([{ kind: "group", ref: "grp1" }]), guests, s, emptyCast());
    expect(result.people.map((p) => p.name).sort()).toEqual(["A", "B"]);
  });

  it("resolves a role member through the cast", () => {
    const guests = { g1: guest("g1", { firstName: "Charis" }) };
    const cast: Cast = { ...emptyCast(), bride: ["g1"] };
    const result = resolveShot(shot([{ kind: "role", ref: "bride" }]), guests, seating(), cast);
    expect(result.people.map((p) => p.name)).toEqual(["Charis"]);
  });

  it("resolves a text member with no guest id", () => {
    const result = resolveShot(shot([{ kind: "text", ref: "the dog" }]), {}, seating(), emptyCast());
    expect(result.people).toEqual([{ guestId: null, name: "the dog", rsvpStatus: null }]);
  });
});

describe("resolveShot: dedupe and order", () => {
  it("prints a guest once, at their first position, even named twice", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const s = seating({ families: { fam1: { id: "fam1", name: "F", memberIds: ["g1"] } } });
    const result = resolveShot(
      shot([{ kind: "guest", ref: "g2" }, { kind: "family", ref: "fam1" }, { kind: "guest", ref: "g1" }]),
      guests,
      s,
      emptyCast(),
    );
    expect(result.people.map((p) => p.name)).toEqual(["B", "A"]);
  });
});

describe("resolveShot: problems", () => {
  it("flags a guest member that does not exist", () => {
    const result = resolveShot(shot([{ kind: "guest", ref: "ghost" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "dangling", detail: expect.stringContaining("no longer exists") }]);
  });

  it("flags a family member that does not exist", () => {
    const result = resolveShot(shot([{ kind: "family", ref: "ghost" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "dangling", detail: expect.stringContaining("family") }]);
  });

  it("flags a role with nobody set", () => {
    const result = resolveShot(shot([{ kind: "role", ref: "bride" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual(
      expect.arrayContaining([{ kind: "dangling", detail: expect.stringContaining("the bride") }]),
    );
  });

  it("flags a declined guest without dropping them from the shot", () => {
    const guests = { g1: guest("g1", { firstName: "Charis", rsvpStatus: "declined" }) };
    const result = resolveShot(shot([{ kind: "guest", ref: "g1" }]), guests, seating(), emptyCast());
    expect(result.people).toHaveLength(1);
    expect(result.problems).toEqual([{ kind: "declined", name: "Charis" }]);
  });

  it("flags an empty shot when nothing resolves to a person", () => {
    const result = resolveShot(shot([]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "empty" }]);
  });
});

describe("resolveShot: label", () => {
  it("keeps a typed label as-is", () => {
    const result = resolveShot(shot([], { label: "Couple, alone" }), {}, seating(), emptyCast());
    expect(result.label).toBe("Couple, alone");
  });

  it("builds a blank label from the resolved names", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const result = resolveShot(
      shot([{ kind: "guest", ref: "g1" }, { kind: "guest", ref: "g2" }]),
      guests,
      seating(),
      emptyCast(),
    );
    expect(result.label).toBe("A + B");
  });

  it("falls back to a placeholder when a blank label resolves to nobody", () => {
    const result = resolveShot(shot([]), {}, seating(), emptyCast());
    expect(result.label).toBe("Untitled shot");
  });
});
