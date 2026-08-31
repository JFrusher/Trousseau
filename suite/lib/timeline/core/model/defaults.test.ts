import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDoc, sampleDoc, SCHEMA_VERSION } from "./defaults";

describe("emptyDoc", () => {
  it("is a valid empty document", () => {
    const doc = emptyDoc();
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.blocks).toEqual([]);
    expect(doc.lanes.length).toBeGreaterThan(0);
    expect(Object.keys(doc.styles)).toHaveLength(4);
  });

  it("hands out fresh objects, not shared ones", () => {
    const a = emptyDoc();
    const b = emptyDoc();
    a.lanes.push("Extra");
    expect(b.lanes).not.toContain("Extra");
  });
});

describe("sampleDoc", () => {
  it("matches the fixture on disk, so the two cannot drift", () => {
    const onDisk = JSON.parse(readFileSync("fixtures/sample-day.cadence.json", "utf8"));
    expect(onDisk).toEqual(sampleDoc());
  });

  it("is a realistic day", () => {
    const doc = sampleDoc();
    expect(doc.blocks.length).toBeGreaterThanOrEqual(25);
    expect(new Set(doc.blocks.map((b) => b.lane)).size).toBe(3);
    expect(doc.blocks.some((b) => b.anchorMin !== null)).toBe(true);
    expect(doc.blocks.some((b) => b.anchorMin === null)).toBe(true);
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(doc.blocks.length);
    for (const block of doc.blocks) expect(doc.lanes).toContain(block.lane);
  });
});
