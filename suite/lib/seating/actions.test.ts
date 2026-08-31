import { beforeEach, expect, test } from "vitest";
import { newGuest, newTable } from "@/lib/model/factories";
import { emptySeating } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import { addTable, reconcile, removeTable, seatedAt, seatGuest, unseated, unseatGuest, type Plan } from "./actions";
import { getTableGeometry } from "./geometry";

function guest(id: string, firstName: string, lastName = ""): Guest {
  return newGuest({ id, firstName, lastName, rsvpStatus: "confirmed" });
}

let plan: Plan;
let t1: string;
let t2: string;

beforeEach(() => {
  let seating = addTable(emptySeating(), "round", { x: 100, y: 100 });
  t1 = Object.keys(seating.tables)[0]!;
  seating = addTable(seating, "round", { x: 400, y: 100 });
  t2 = Object.keys(seating.tables).find((id) => id !== t1)!;
  plan = {
    guests: {
      g1: guest("g1", "Charis", "Smith"),
      g2: guest("g2", "Alexander", "Wright"),
      g3: guest("g3", "Eleanor", "Vane"),
    },
    seating,
  };
});

test("tables are numbered from the lowest free number", () => {
  expect(plan.seating.tables[t1]!.label).toBe("Table 1");
  expect(plan.seating.tables[t2]!.label).toBe("Table 2");
});

test("seating a guest records it on both the guest and the table", () => {
  const next = seatGuest(plan, "g1", t1);
  expect(next.guests["g1"]!.assignedTableId).toBe(t1);
  expect(next.seating.tables[t1]!.assignedGuestIds).toEqual(["g1"]);
});

test("moving a guest to another table leaves no ghost at the old one", () => {
  let next = seatGuest(plan, "g1", t1);
  next = seatGuest(next, "g1", t2);
  expect(next.seating.tables[t1]!.assignedGuestIds).toEqual([]);
  expect(next.seating.tables[t2]!.assignedGuestIds).toEqual(["g1"]);
  expect(next.guests["g1"]!.assignedTableId).toBe(t2);
});

test("dropping onto a taken seat moves the sitter rather than deleting them", () => {
  let next = { ...plan, seating: { ...plan.seating, tables: { ...plan.seating.tables, [t1]: { ...plan.seating.tables[t1]!, seatMode: "seat" as const } } } };
  next = seatGuest(next, "g1", t1, 2);
  next = seatGuest(next, "g2", t1, 2);

  const ids = next.seating.tables[t1]!.assignedGuestIds;
  expect(ids[2]).toBe("g2");
  expect(ids).toContain("g1");
  expect(next.guests["g1"]!.assignedTableId).toBe(t1);
});

test("a seat-mode table keeps its holes so seat numbers do not shift", () => {
  let next = { ...plan, seating: { ...plan.seating, tables: { ...plan.seating.tables, [t1]: { ...plan.seating.tables[t1]!, seatMode: "seat" as const } } } };
  next = seatGuest(next, "g1", t1, 0);
  next = seatGuest(next, "g2", t1, 1);
  next = seatGuest(next, "g3", t1, 2);
  next = unseatGuest(next, "g2");

  expect(next.seating.tables[t1]!.assignedGuestIds).toEqual(["g1", null, "g3"]);
  expect(seatedAt(next, t1).map((s) => s.seat)).toEqual([0, 2]);
});

test("deleting a table frees its guests instead of losing them", () => {
  let next = seatGuest(plan, "g1", t1);
  next = seatGuest(next, "g2", t1);
  next = removeTable(next, t1);

  expect(next.seating.tables[t1]).toBeUndefined();
  expect(Object.keys(next.guests)).toHaveLength(3);
  expect(unseated(next).map((g) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
});

test("a restored document with the two sides disagreeing is reconciled to the tables", () => {
  const broken: Plan = {
    guests: { ...plan.guests, g1: { ...plan.guests["g1"]!, assignedTableId: t2 } },
    seating: {
      ...plan.seating,
      tables: { ...plan.seating.tables, [t1]: { ...plan.seating.tables[t1]!, assignedGuestIds: ["g1"] } },
    },
  };

  expect(reconcile(broken).guests["g1"]!.assignedTableId).toBe(t1);
});

test("a round table's seats sit outside its edge and are evenly spaced", () => {
  const geometry = getTableGeometry(plan.seating.tables[t1]!);
  expect(geometry.seats).toHaveLength(8);
  const radii = geometry.seats.map((s) => Math.hypot(s.x, s.y));
  for (const r of radii) expect(r).toBeGreaterThan(geometry.radius);
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
});

test("a top table seats everyone on one side", () => {
  const seating = addTable(emptySeating(), "top-table", { x: 0, y: 0 });
  const table = Object.values(seating.tables)[0]!;
  const geometry = getTableGeometry(table);
  expect(geometry.seats).toHaveLength(table.capacity);
  // All below the table's centre line: nobody sits with their back to the room.
  for (const seat of geometry.seats) expect(seat.y).toBeGreaterThan(0);
});
