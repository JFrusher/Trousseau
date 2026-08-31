import { beforeEach, expect, test } from "vitest";
import { newGuest, newTable } from "@/lib/model/factories";
import { emptySeating } from "@/lib/model/slices";
import { seatGuest, type Plan } from "./actions";
import {
  addConstraint,
  addGroup,
  assignToGroup,
  danglingConstraints,
  EMPTY_FILTER,
  filterGuests,
  removeConstraint,
  removeGroup,
} from "./organise";
import { computeWarnings } from "./warnings";

let plan: Plan;

beforeEach(() => {
  plan = {
    guests: {
      g1: newGuest({ id: "g1", firstName: "Charis", lastName: "Smith", rsvpStatus: "confirmed", dietary: "Vegan" }),
      g2: newGuest({ id: "g2", firstName: "Alexander", lastName: "Wright", rsvpStatus: "confirmed" }),
      g3: newGuest({ id: "g3", firstName: "Eleanor", lastName: "Vane", rsvpStatus: "declined" }),
    },
    seating: {
      ...emptySeating(),
      tables: {
        t1: newTable({ id: "t1", label: "Table 1", capacity: 2 }),
        t2: newTable({ id: "t2", label: "Table 2", capacity: 8 }),
      },
    },
  };
});

// groups ------------------------------------------------------------------

test("deleting a group detaches its members rather than deleting them", () => {
  let seating = addGroup(plan.seating, "groups", "Bride's side");
  const groupId = Object.keys(seating.groups)[0]!;
  let next = assignToGroup({ ...plan, seating }, "g1", "groups", groupId);
  expect(next.guests["g1"]!.groupId).toBe(groupId);

  next = removeGroup(next, "groups", groupId);
  expect(Object.keys(next.guests)).toHaveLength(3);
  expect(next.guests["g1"]!.groupId).toBeNull();
});

test("a family records its members on both sides", () => {
  const seating = addGroup(plan.seating, "families", "The Smiths");
  const familyId = Object.keys(seating.families)[0]!;

  let next = assignToGroup({ ...plan, seating }, "g1", "families", familyId);
  expect(next.seating.families[familyId]!.memberIds).toEqual(["g1"]);

  next = assignToGroup(next, "g1", "families", null);
  expect(next.seating.families[familyId]!.memberIds).toEqual([]);
  expect(next.guests["g1"]!.familyId).toBeNull();
});

// constraints -------------------------------------------------------------

test("the same pair cannot be given two rules, in either order", () => {
  let seating = addConstraint(plan.seating, "apart", "g1", "g2");
  seating = addConstraint(seating, "together", "g2", "g1");
  expect(seating.constraints).toHaveLength(1);
  expect(seating.constraints[0]!.kind).toBe("apart");
});

test("a rule about someone and themselves is refused", () => {
  expect(addConstraint(plan.seating, "apart", "g1", "g1").constraints).toHaveLength(0);
});

test("a rule naming a guest who has gone is reported, not silently dropped", () => {
  const seating = addConstraint(plan.seating, "apart", "g1", "gone");
  expect(danglingConstraints({ ...plan, seating })).toHaveLength(1);
});

test("removing a rule removes only that rule", () => {
  let seating = addConstraint(plan.seating, "apart", "g1", "g2");
  seating = addConstraint(seating, "together", "g1", "g3");
  const id = seating.constraints[0]!.id;
  expect(removeConstraint(seating, id).constraints).toHaveLength(1);
});

// warnings ----------------------------------------------------------------

test("two people who must not sit together, sitting together, is a warning", () => {
  let seating = addConstraint(plan.seating, "apart", "g1", "g2");
  let next = seatGuest({ ...plan, seating }, "g1", "t1");
  next = seatGuest(next, "g2", "t1");

  const found = computeWarnings(next.guests, next.seating);
  expect(found.filter((w) => w.kind === "apart")).toHaveLength(1);
  expect(found.find((w) => w.kind === "apart")!.message).toContain("Table 1");
});

test("two people who must sit together, at different tables, is a warning", () => {
  const seating = addConstraint(plan.seating, "together", "g1", "g2");
  let next = seatGuest({ ...plan, seating }, "g1", "t1");
  next = seatGuest(next, "g2", "t2");
  expect(computeWarnings(next.guests, next.seating).some((w) => w.kind === "together")).toBe(true);
});

test("a table past its capacity is a warning", () => {
  let next = seatGuest(plan, "g1", "t1");
  next = seatGuest(next, "g2", "t1");
  next = seatGuest(next, "g3", "t1");
  const over = computeWarnings(next.guests, next.seating).find((w) => w.kind === "over-capacity");
  expect(over?.message).toContain("3/2");
});

test("a split family produces one warning, not one per person", () => {
  let seating = addGroup(plan.seating, "families", "The Smiths");
  const familyId = Object.keys(seating.families)[0]!;
  let next: Plan = { ...plan, seating };
  for (const id of ["g1", "g2", "g3"]) next = assignToGroup(next, id, "families", familyId);
  next = seatGuest(next, "g1", "t1");
  next = seatGuest(next, "g2", "t2");
  next = seatGuest(next, "g3", "t2");

  const splits = computeWarnings(next.guests, next.seating).filter((w) => w.kind === "family-split");
  expect(splits).toHaveLength(1);
  expect(splits[0]!.message).toContain("Table 1, Table 2");
});

test("declined guests are not counted as unseated", () => {
  // Two confirmed of three guests, both seated: nothing outstanding.
  let next = seatGuest(plan, "g1", "t2");
  next = seatGuest(next, "g2", "t2");
  expect(computeWarnings(next.guests, next.seating).some((w) => w.kind === "unassigned")).toBe(false);
});

// filtering ---------------------------------------------------------------

test("search covers the dietary note, not just the name", () => {
  const all = Object.values(plan.guests);
  expect(filterGuests(all, { ...EMPTY_FILTER, query: "vegan" }).map((g) => g.id)).toEqual(["g1"]);
});

test("filters combine rather than replace each other", () => {
  const all = Object.values(plan.guests);
  const found = filterGuests(all, { ...EMPTY_FILTER, rsvp: "confirmed", seated: "unseated" });
  expect(found.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
});
