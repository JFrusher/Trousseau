import { describe, expect, it } from "vitest";
import { SLICE_NAMES, mergeSlice, migrate, trousseauSchema } from "./envelope";

/** A document carrying data from an app that does not exist yet. */
const fromTheFuture = () => ({
  kind: "trousseau",
  version: 1,
  event: { coupleNames: "Charis & Jacob", hashtag: "#cj2026" },
  guests: { "g-1": { name: "Priya" } },
  seating: { "g-1": { tableLabel: "7", seat: 3 } },
  day: {
    kind: "cadence.day",
    version: 1,
    day: { date: "2026-06-20", coupleNames: "Charis & Jacob", venueName: "Vane House", curfewMin: 1500, utcOffsetMin: 60 },
    blocks: [{ id: "blk-ceremony", label: "Ceremony", lane: "Main day", startMin: 780, endMin: 810 }],
  },
  crew: { jobs: [{ id: "job-1", label: "Lay 90 covers" }], unknownCrewKey: true },
  florals: { arch: "peonies", budget: 1200 },
  stationery: { cardWidthMm: 90, secretPlaqueField: true },
});

describe("rule 1: an app rewrites only its own slice", () => {
  for (const slice of SLICE_NAMES) {
    it(`publishing ${slice} preserves the unknown florals slice`, () => {
      const merged = mergeSlice(fromTheFuture(), slice, {});
      expect(merged["florals"]).toEqual({ arch: "peonies", budget: 1200 });
    });

    it(`publishing ${slice} leaves every other known slice untouched`, () => {
      const before = fromTheFuture();
      const merged = mergeSlice(before, slice, {});
      for (const other of SLICE_NAMES) {
        if (other === slice) continue;
        expect(merged[other]).toEqual((before as Record<string, unknown>)[other]);
      }
    });
  }
});

describe("rule 2: unknown keys inside a known slice survive", () => {
  it("keeps an unknown key on the event through a parse", () => {
    const parsed = migrate(fromTheFuture());
    expect(parsed.event).toMatchObject({ hashtag: "#cj2026" });
  });

  it("keeps an unknown key on the stationery slice through a parse", () => {
    const parsed = migrate(fromTheFuture());
    expect(parsed.stationery).toMatchObject({ secretPlaqueField: true });
  });
});

describe("no schema in this package strips unknown keys", () => {
  it("round-trips a document with an unknown slice byte-for-byte", () => {
    const before = fromTheFuture();
    const after = trousseauSchema.parse(structuredClone(before)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(before)) {
      // Primitives compare whole; objects only need to be a superset, because
      // parsing fills defaults the input did not carry.
      if (value !== null && typeof value === "object") {
        expect(after[key]).toMatchObject(value);
      } else {
        expect(after[key]).toEqual(value);
      }
    }
  });
});

describe("mergeSlice does not mutate its input", () => {
  it("leaves the original document alone", () => {
    const before = fromTheFuture();
    const snapshot = structuredClone(before);
    mergeSlice(before, "crew", { jobs: [] });
    expect(before).toEqual(snapshot);
  });
});

describe("mergeSlice writes the slice it is given", () => {
  for (const slice of SLICE_NAMES) {
    it(`sets ${slice} to the published value`, () => {
      const merged = mergeSlice(fromTheFuture(), slice, { marker: slice });
      expect(merged[slice]).toEqual({ marker: slice });
    });
  }

  it("keeps an existing version rather than resetting it", () => {
    const merged = mergeSlice({ kind: "trousseau", version: 7 }, "crew", {});
    expect(merged["version"]).toBe(7);
  });

  it("stamps kind and version onto a document that has neither", () => {
    const merged = mergeSlice({}, "crew", {});
    expect(merged["kind"]).toBe("trousseau");
    expect(merged["version"]).toBe(1);
  });
});
