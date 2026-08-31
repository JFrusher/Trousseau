import { beforeEach, expect, test, vi } from "vitest";
import { emptyTrousseau, migrate, parse, serialise } from "@jfrusher/trousseau";

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  keys: async () => [...db.keys()],
}));

const { STORAGE_KEY, flushPersist, useTrousseauStore } = await import(
  "@/lib/store/useTrousseauStore"
);
const { publishDay, readCrew, readGuests, readSeating, readTimeline, resolvedDay } = await import(
  "./slices"
);
const { addTable, seatGuest } = await import("@/lib/seating/actions");
const { addBlock, patchBlock } = await import("@/lib/timeline/actions");
const { addJob, addPerson, seedTeamsFromTags, toggleAssignment } = await import(
  "@/lib/crew/actions"
);

/**
 * Step 4's requirement, as a test: a wedding built through the tools survives
 * an export and a restore with nothing lost — including keys this app has never
 * heard of.
 */

const store = () => useTrousseauStore.getState();

beforeEach(async () => {
  db.clear();
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "idle",
    error: null,
    savedAt: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
  });
  await store().hydrate();
});

function buildAWedding(): void {
  store().setSlice("event", {
    date: "2026-09-12",
    coupleNames: "Charis & Jacob",
    venueName: "The barn",
    curfewMin: 23 * 60 + 30,
    utcOffsetMin: 60,
  });

  const guests = {
    g1: {
      id: "g1",
      firstName: "Eleanor",
      lastName: "Vane",
      email: "",
      rsvpStatus: "confirmed",
      dietary: "Gluten-Free",
      entree: "Chicken",
      notes: "",
      side: "bride",
      groupId: null,
      subgroupId: null,
      familyId: null,
      assignedTableId: null,
    },
  };
  store().setSlice("guests", guests);

  const seating = addTable(readSeating(store().doc), "round", { x: 200, y: 200 });
  const tableId = Object.keys(seating.tables)[0]!;
  const plan = seatGuest({ guests: readGuests(store().doc), seating }, "g1", tableId);
  store().setSlices([
    ["guests", plan.guests],
    ["seating", plan.seating],
  ]);

  let timeline = addBlock(readTimeline(store().doc), "Couple");
  const ceremony = timeline.blocks[0]!.id;
  timeline = patchBlock(timeline, ceremony, {
    label: "Ceremony",
    anchorMin: 13 * 60,
    durationMin: 45,
    tags: ["registrar"],
  });
  timeline = addBlock(timeline, "Couple", ceremony);
  const drinks = timeline.blocks[1]!.id;
  timeline = patchBlock(timeline, drinks, { label: "Drinks", durationMin: 90, gapMin: 15 });
  store().setSlices([
    ["timeline", timeline],
    ["day", publishDay(store().doc, timeline)],
  ]);

  let crew = seedTeamsFromTags(readCrew(store().doc), timeline);
  crew = addPerson(crew, "Marion", crew.teams[0]?.id ?? null);
  crew = addJob(crew, ceremony, "Hand over the rings");
  crew = toggleAssignment(crew, crew.jobs[0]!.id, crew.people[0]!.id);
  store().setSlice("crew", crew);
}

test("a floating block starts when the one before it ends, plus its gap", () => {
  buildAWedding();
  const placed = resolvedDay(store().doc);
  const [ceremony, drinks] = placed;

  expect(ceremony!.startMin).toBe(13 * 60);
  expect(ceremony!.endMin).toBe(13 * 60 + 45);
  expect(drinks!.startMin).toBe(13 * 60 + 60);
});

test("editing the timeline republishes the resolved day in the same change", () => {
  buildAWedding();
  const day = (store().raw as Record<string, unknown>)["day"] as Record<string, unknown>;

  expect(day["kind"]).toBe("cadence.day");
  const blocks = day["blocks"] as Array<Record<string, unknown>>;
  expect(blocks.map((b) => b["startMin"])).toEqual([13 * 60, 13 * 60 + 60]);
  // The published day carries the couple's own details, so a reader outside
  // this app knows whose wedding it is looking at.
  expect((day["day"] as Record<string, unknown>)["coupleNames"]).toBe("Charis & Jacob");
});

test("an exported backup restores byte for byte, unknown slices included", async () => {
  buildAWedding();

  // A slice belonging to a tool nobody has written yet.
  store().setSlice("photobooth" as never, { props: ["top hat"], hours: 3 });
  await flushPersist();

  const exported = serialise(migrate(store().raw));
  const restored = parse(exported);

  // Round-tripped through the contract's own reader and writer.
  expect(serialise(restored)).toBe(exported);

  store().replaceDocument(restored);
  await flushPersist();

  expect(readGuests(store().doc)["g1"]!.entree).toBe("Chicken");
  expect(Object.values(readSeating(store().doc).tables)[0]!.assignedGuestIds).toEqual(["g1"]);
  expect(readTimeline(store().doc).blocks.map((b) => b.label)).toEqual(["Ceremony", "Drinks"]);
  expect(readCrew(store().doc).jobs[0]!.label).toBe("Hand over the rings");
  expect(store().doc.event.coupleNames).toBe("Charis & Jacob");
  expect((store().raw as Record<string, unknown>)["photobooth"]).toEqual({
    props: ["top hat"],
    hours: 3,
  });
});

test("what is stored is what is restored — the whole document, not a summary", async () => {
  buildAWedding();
  await flushPersist();

  const stored = db.get(STORAGE_KEY) as Record<string, unknown>;
  for (const slice of ["event", "guests", "seating", "timeline", "day", "crew"]) {
    expect(stored[slice], `${slice} reached storage`).toBeDefined();
  }
});

test("a seated guest and their table never disagree about where they sit", () => {
  buildAWedding();
  const guest = readGuests(store().doc)["g1"]!;
  const table = Object.values(readSeating(store().doc).tables)[0]!;

  expect(guest.assignedTableId).toBe(table.id);
  expect(table.assignedGuestIds).toContain(guest.id);
});
