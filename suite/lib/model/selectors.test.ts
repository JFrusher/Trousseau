import { expect, test } from "vitest";
import { emptyTrousseau, migrate } from "@jfrusher/trousseau";
import { readCrew, readGuests, readSeating, readShots, readTimeline, resolvedDay, timelineDoc } from "./slices";

/**
 * Every slice reader must return the same object for the same document.
 *
 * These are called from inside store selectors. Under `useSyncExternalStore` a
 * selector that allocates hands back a new reference on every render, which is
 * an infinite update loop — React error #185 — not merely a slow render. It has
 * happened twice in this codebase, both times found by driving a browser rather
 * than by a test. This is that test.
 */

const doc = migrate({
  ...emptyTrousseau(),
  guests: { g1: { id: "g1", firstName: "Charis" } },
  seating: { tables: { t1: { id: "t1", label: "Table 1" } } },
  timeline: { lanes: ["Couple"], blocks: [], tagDetails: [] },
  crew: { teams: [], people: [], jobs: [] },
  shots: { cast: {}, sections: [{ id: "sec1", name: "Family", shots: [] }] },
  stationery: { rowSource: "plan" },
});

test.each([
  ["guests", () => readGuests(doc)],
  ["seating", () => readSeating(doc)],
  ["timeline", () => readTimeline(doc)],
  ["crew", () => readCrew(doc)],
  ["shots", () => readShots(doc)],
  ["timelineDoc", () => timelineDoc(doc)],
  ["resolved day", () => resolvedDay(doc)],
])("reading %s twice returns the same object", (_name, read) => {
  expect(read()).toBe(read());
});

test("a different document gets its own reading", () => {
  const other = migrate({ ...emptyTrousseau(), guests: { g2: { id: "g2" } } });
  expect(readGuests(other)).not.toBe(readGuests(doc));
  expect(Object.keys(readGuests(other))).toEqual(["g2"]);
});
