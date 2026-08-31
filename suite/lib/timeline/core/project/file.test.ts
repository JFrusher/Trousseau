import { describe, expect, it } from "vitest";
import { sampleDoc, SCHEMA_VERSION } from "../model/defaults";
import { parse, serialise, suggestedFilename } from "./file";

describe("serialise and parse", () => {
  it("round trips the fixture unchanged", () => {
    const result = parse(serialise(sampleDoc()));
    expect(result.error).toBeUndefined();
    expect(result.doc).toEqual(sampleDoc());
  });

  it("returns an error, never a throw, for rubbish", () => {
    for (const input of ["", "   ", "{", "not json", "[]", "null", "42"]) {
      const result = parse(input);
      expect(result.error).toBeTypeOf("string");
      expect(result.doc).toBeUndefined();
    }
  });

  it("names the field that is missing", () => {
    const doc = sampleDoc();
    const broken = JSON.stringify({ ...doc, day: { ...doc.day, latitude: "north a bit" } });
    expect(parse(broken).error).toMatch(/latitude/);
  });

  it("rejects a block with no id", () => {
    const doc = sampleDoc();
    const blocks = doc.blocks.map((block, index) =>
      index === 2 ? { ...block, id: undefined } : block,
    );
    expect(parse(JSON.stringify({ ...doc, blocks })).error).toMatch(/Block 2 has no id/);
  });

  it("stamps the current schema version", () => {
    const written = JSON.parse(serialise(sampleDoc()));
    expect(written.schemaVersion).toBe(SCHEMA_VERSION);
    expect(written.appVersion).toBeTypeOf("string");
  });
});

describe("suggestedFilename", () => {
  it("slugs the couple's names", () => {
    expect(suggestedFilename(sampleDoc())).toBe("charis-and-jacob.cadence.json");
  });

  it("falls back when there are no names yet", () => {
    const doc = sampleDoc();
    expect(suggestedFilename({ ...doc, day: { ...doc.day, coupleNames: "" } })).toBe(
      "cadence-day.cadence.json",
    );
  });
});
