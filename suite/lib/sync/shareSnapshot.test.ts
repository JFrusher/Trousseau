import { expect, test } from "vitest";
import { newGuest, newTable } from "@/lib/model/factories";
import { emptySeating } from "@/lib/model/slices";
import type { Guest } from "@/lib/model/types";
import { findSeat, shareSnapshot } from "./shareSnapshot";

/**
 * The redaction, as tests.
 *
 * This is the boundary between a private wedding and a link anybody may open,
 * so what it must NOT publish is asserted directly rather than inferred from
 * what it does publish.
 */

const guests: Record<string, Guest> = {
  g1: newGuest({
    id: "g1",
    firstName: "Charis",
    lastName: "Smith",
    rsvpStatus: "confirmed",
    email: "charis@example.test",
    dietary: "Coeliac",
    entree: "Chicken",
    notes: "Do not seat near the band",
    assignedTableId: "t1",
  }),
  g2: newGuest({
    id: "g2",
    firstName: "Alexander",
    lastName: "Wright",
    rsvpStatus: "declined",
    email: "alex@example.test",
  }),
  g3: newGuest({ id: "g3", firstName: "Éleanor", lastName: "Vane", rsvpStatus: "confirmed" }),
};

const seating = {
  ...emptySeating(),
  tables: {
    t1: newTable({ id: "t1", label: "Table 1", seatMode: "seat", assignedGuestIds: [null, "g1"] }),
  },
};

const event = { coupleNames: "Charis & Jacob", venueName: "The barn", date: "2026-09-12" };

test("a share carries names and tables and nothing else about a guest", () => {
  const snapshot = shareSnapshot(guests, seating, event, { showPlan: false });
  const published = JSON.stringify(snapshot);

  for (const secret of [
    "charis@example.test",
    "Coeliac",
    "Chicken",
    "Do not seat near the band",
    "confirmed",
  ]) {
    expect(published, `"${secret}" must not be published`).not.toContain(secret);
  }

  expect(snapshot.guests).toContainEqual({ name: "Charis Smith", table: "Table 1", seat: 2 });
});

test("somebody who declined is not published at all", () => {
  const snapshot = shareSnapshot(guests, seating, event, { showPlan: false });
  expect(snapshot.guests.some((g) => g.name.includes("Alexander"))).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain("alex@example.test");
});

test("the room is published only when the couple asks for it", () => {
  expect(shareSnapshot(guests, seating, event, { showPlan: false }).tables).toBeNull();
  const withPlan = shareSnapshot(guests, seating, event, { showPlan: true });
  expect(withPlan.tables).toHaveLength(1);
  // The table's own guest list is not part of what a table publishes.
  expect(JSON.stringify(withPlan.tables)).not.toContain("g1");
});

test("an unseated guest is published without a table rather than left out", () => {
  const snapshot = shareSnapshot(guests, seating, event, { showPlan: false });
  expect(snapshot.guests).toContainEqual({ name: "Éleanor Vane", table: null, seat: null });
});

test("a search ignores accents and case", () => {
  const snapshot = shareSnapshot(guests, seating, event, { showPlan: false });
  expect(findSeat(snapshot, "eleanor")[0]?.name).toBe("Éleanor Vane");
  expect(findSeat(snapshot, "VANE")[0]?.name).toBe("Éleanor Vane");
});

test("a search too short to be a name returns nothing", () => {
  const snapshot = shareSnapshot(guests, seating, event, { showPlan: false });
  // Otherwise one letter at a time walks the whole guest list.
  expect(findSeat(snapshot, "e")).toEqual([]);
  expect(findSeat(snapshot, "")).toEqual([]);
});

test("a search returns a handful, not the list", () => {
  const many: Record<string, Guest> = {};
  for (let i = 0; i < 40; i++) {
    many[`g${i}`] = newGuest({ id: `g${i}`, firstName: "Sam", lastName: `Smith${i}`, rsvpStatus: "confirmed" });
  }
  const snapshot = shareSnapshot(many, emptySeating(), event, { showPlan: false });
  expect(findSeat(snapshot, "sam")).toHaveLength(5);
});
