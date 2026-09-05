import { describe, expect, it } from "vitest";
import type { Shots } from "@/lib/model/types";
import {
  addCustomRole,
  addMember,
  addSection,
  addShot,
  duplicateShot,
  patchShot,
  removeCustomRole,
  removeMember,
  removeSection,
  removeShot,
  renameCustomRole,
  renameSection,
  reorderSections,
  reorderShot,
  setCastRole,
  setCustomRoleMembers,
} from "./actions";

const empty: Shots = { cast: {} as Shots["cast"], customRoles: [], sections: [] };

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

  it("duplicates a shot into the same section, right after the original", () => {
    let shots = withSection();
    const id = shots.sections[0]!.id;
    shots = addShot(shots, id);
    shots = addShot(shots, id);
    const originalId = shots.sections[0]!.shots[0]!.id;
    shots = patchShot(shots, originalId, {
      label: "Bride + groom",
      members: [{ kind: "role", ref: "bride" }],
      notes: "Golden hour",
    });

    const duplicated = duplicateShot(shots, originalId, "shot_copy");
    const rowIds = duplicated.sections[0]!.shots.map((s) => s.id);
    expect(rowIds).toEqual([originalId, "shot_copy", shots.sections[0]!.shots[1]!.id]);

    const copy = duplicated.sections[0]!.shots[1]!;
    expect(copy).toMatchObject({
      label: "Bride + groom",
      members: [{ kind: "role", ref: "bride" }],
      notes: "Golden hour",
    });
  });

  it("duplicating an unknown shot id changes nothing", () => {
    const shots = withSection();
    expect(duplicateShot(shots, "nope")).toEqual(shots);
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

describe("custom roles", () => {
  it("adds a custom role by name", () => {
    const shots = addCustomRole(empty, "Me and my family");
    expect(shots.customRoles).toHaveLength(1);
    expect(shots.customRoles[0]).toMatchObject({ name: "Me and my family", guestIds: [] });
  });

  it("renames a custom role by id", () => {
    const shots = addCustomRole(empty, "Old name");
    const id = shots.customRoles[0]!.id;
    expect(renameCustomRole(shots, id, "New name").customRoles[0]!.name).toBe("New name");
  });

  it("removes a custom role by id", () => {
    const shots = addCustomRole(empty, "Gone");
    const id = shots.customRoles[0]!.id;
    expect(removeCustomRole(shots, id).customRoles).toEqual([]);
  });

  it("sets a custom role's guest ids, replacing whatever was there", () => {
    const shots = addCustomRole(empty, "Ushers");
    const id = shots.customRoles[0]!.id;
    const withMembers = setCustomRoleMembers(shots, id, ["g1", "g2"]);
    expect(withMembers.customRoles[0]!.guestIds).toEqual(["g1", "g2"]);
    expect(setCustomRoleMembers(withMembers, id, []).customRoles[0]!.guestIds).toEqual([]);
  });
});
