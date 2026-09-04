import { describe, expect, it } from "vitest";
import type { Shots } from "@/lib/model/types";
import {
  addMember,
  addSection,
  addShot,
  patchShot,
  removeMember,
  removeSection,
  removeShot,
  renameSection,
  reorderSections,
  reorderShot,
  setCastRole,
} from "./actions";

const empty: Shots = { cast: {} as Shots["cast"], sections: [] };

describe("sections", () => {
  it("adds a section with the given name", () => {
    const shots = addSection(empty, "Bride's family");
    expect(shots.sections).toHaveLength(1);
    expect(shots.sections[0]!.name).toBe("Bride's family");
    expect(shots.sections[0]!.shots).toEqual([]);
  });

  it("renames a section by id", () => {
    const shots = addSection(empty, "Old");
    const id = shots.sections[0]!.id;
    expect(renameSection(shots, id, "New").sections[0]!.name).toBe("New");
  });

  it("removes a section by id", () => {
    const shots = addSection(empty, "Gone");
    const id = shots.sections[0]!.id;
    expect(removeSection(shots, id).sections).toEqual([]);
  });

  it("reorders sections", () => {
    let shots = addSection(empty, "A");
    shots = addSection(shots, "B");
    shots = addSection(shots, "C");
    const reordered = reorderSections(shots, 0, 2);
    expect(reordered.sections.map((s) => s.name)).toEqual(["B", "C", "A"]);
  });
});

describe("shots", () => {
  const withSection = () => addSection(empty, "Family");

  it("adds a blank shot to a section", () => {
    const base = withSection();
    const shots = addShot(base, base.sections[0]!.id);
    expect(shots.sections[0]!.shots).toHaveLength(1);
    expect(shots.sections[0]!.shots[0]!).toMatchObject({ label: "", members: [], notes: "" });
  });

  it("patches a shot by id, wherever its section is", () => {
    const section = withSection();
    const base = addShot(section, section.sections[0]!.id);
    const shotId = base.sections[0]!.shots[0]!.id;
    const patched = patchShot(base, shotId, { label: "Couple, alone" });
    expect(patched.sections[0]!.shots[0]!.label).toBe("Couple, alone");
  });

  it("removes a shot by id", () => {
    const section = withSection();
    const base = addShot(section, section.sections[0]!.id);
    const shotId = base.sections[0]!.shots[0]!.id;
    expect(removeShot(base, shotId).sections[0]!.shots).toEqual([]);
  });

  it("reorders shots within their own section", () => {
    let shots = withSection();
    const id = shots.sections[0]!.id;
    shots = addShot(shots, id);
    shots = addShot(shots, id);
    shots = patchShot(shots, shots.sections[0]!.shots[0]!.id, { label: "first" });
    shots = patchShot(shots, shots.sections[0]!.shots[1]!.id, { label: "second" });
    const reordered = reorderShot(shots, id, 0, 1);
    expect(reordered.sections[0]!.shots.map((s) => s.label)).toEqual(["second", "first"]);
  });
});

describe("members", () => {
  it("adds and removes a member by index", () => {
    let shots = addSection(empty, "Family");
    shots = addShot(shots, shots.sections[0]!.id);
    const shotId = shots.sections[0]!.shots[0]!.id;

    shots = addMember(shots, shotId, { kind: "guest", ref: "g1" });
    shots = addMember(shots, shotId, { kind: "text", ref: "the dog" });
    expect(shots.sections[0]!.shots[0]!.members).toEqual([
      { kind: "guest", ref: "g1" },
      { kind: "text", ref: "the dog" },
    ]);

    shots = removeMember(shots, shotId, 0);
    expect(shots.sections[0]!.shots[0]!.members).toEqual([{ kind: "text", ref: "the dog" }]);
  });
});

describe("cast", () => {
  it("sets a role's guest ids, replacing whatever was there", () => {
    const withRole = setCastRole(empty, "bride", ["g1"]);
    expect(withRole.cast.bride).toEqual(["g1"]);
    expect(setCastRole(withRole, "bride", []).cast.bride).toEqual([]);
  });
});
