import { describe, expect, it } from "vitest";
import * as cadence from "@/apps/cadence/state/syncAssets";
import * as plaque from "@/apps/plaque/state/syncAssets";

/**
 * Ids are routed home by prefix, which is the kind of agreement that breaks
 * quietly: a clash sends one tool's monogram to another tool's font store, and
 * a gap drops it on the floor. Neither shows up as a failure until someone
 * opens the wedding on a second machine and finds a hole in their run sheet.
 */

const SOURCES = { plaque, cadence };

const IDS = {
  "plaque.font.abc123": "plaque",
  "plaque.image.def456": "plaque",
  "cadence.blob.font-a1b2c3d4e5": "cadence",
  "cadence.blob.logo-99887766": "cadence",
} as const;

describe("asset ownership", () => {
  it.each(Object.entries(IDS))("%s belongs to exactly one tool", (id, expected) => {
    const claimants = Object.entries(SOURCES)
      .filter(([, source]) => source.owns(id))
      .map(([name]) => name);

    expect(claimants).toEqual([expected]);
  });

  it("claims nothing it does not recognise", () => {
    // A wedding written by a later version of the suite, carrying a tool this
    // one has never heard of. Better ignored than stored somewhere arbitrary.
    for (const source of Object.values(SOURCES)) {
      expect(source.owns("brigade.badge.0001")).toBe(false);
      expect(source.owns("")).toBe(false);
    }
  });
});
