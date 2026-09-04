import { describe, expect, it } from "vitest";
import {
  SLICE_NAMES,
  TROUSSEAU_KIND,
  TROUSSEAU_VERSION,
  emptyTrousseau,
  migrate,
  trousseauSchema,
} from "./envelope.js";

describe("emptyTrousseau", () => {
  it("is a valid document", () => {
    expect(trousseauSchema.safeParse(emptyTrousseau()).success).toBe(true);
  });

  it("has no day until one is published", () => {
    expect(emptyTrousseau().day).toBeNull();
  });

  it("returns a fresh object each call, so callers cannot share state", () => {
    const a = emptyTrousseau();
    a.event.coupleNames = "A & B";
    expect(emptyTrousseau().event.coupleNames).toBe("");
  });
});

describe("SLICE_NAMES", () => {
  it("lists exactly the eight publishable slices", () => {
    expect([...SLICE_NAMES]).toEqual([
      "event",
      "guests",
      "seating",
      "day",
      "crew",
      "stationery",
      "shots",
      "timeline",
    ]);
  });

  it("does not include sources, which is not publishable", () => {
    expect(SLICE_NAMES).not.toContain("sources");
  });
});

describe("migrate", () => {
  it("accepts an empty object as a new, empty wedding", () => {
    const doc = migrate({});
    expect(doc.kind).toBe(TROUSSEAU_KIND);
    expect(doc.version).toBe(TROUSSEAU_VERSION);
  });

  it("accepts a document from the future rather than refusing it", () => {
    expect(() => migrate({ kind: TROUSSEAU_KIND, version: 99 })).not.toThrow();
  });

  it("throws on something that is not a trousseau at all", () => {
    expect(() => migrate({ kind: "cadence.day", version: 1 })).toThrow();
  });

  it("throws on a slice of the wrong type rather than discarding it", () => {
    expect(() => migrate({ guests: "everyone" })).toThrow();
  });
});
