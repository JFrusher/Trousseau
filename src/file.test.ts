import { describe, expect, it } from "vitest";
import { emptyTrousseau } from "./envelope";
import { TROUSSEAU_EXTENSION, parse, serialise, suggestedFilename } from "./file";

describe("serialise", () => {
  it("ends with a newline, so the file is well-formed on disk", () => {
    expect(serialise(emptyTrousseau()).endsWith("\n")).toBe(true);
  });

  it("is indented, so a diff of two weddings is readable", () => {
    expect(serialise(emptyTrousseau())).toContain('\n  "kind"');
  });
});

describe("parse", () => {
  it("round-trips a document", () => {
    const doc = emptyTrousseau();
    doc.event.coupleNames = "Charis & Jacob";
    expect(parse(serialise(doc)).event.coupleNames).toBe("Charis & Jacob");
  });

  it("keeps a slice it does not know about", () => {
    const text = JSON.stringify({ kind: "trousseau", version: 1, florals: { arch: "peonies" } });
    expect(parse(text)).toMatchObject({ florals: { arch: "peonies" } });
  });

  it("explains itself when handed something that is not JSON", () => {
    expect(() => parse("not json at all")).toThrow(/not valid JSON/);
  });

  it("explains itself when handed a Cadence day", () => {
    const day = JSON.stringify({ kind: "cadence.day", version: 1 });
    expect(() => parse(day)).toThrow(/not a Trousseau file/);
  });
});

describe("suggestedFilename", () => {
  it("uses the couple's names", () => {
    const doc = emptyTrousseau();
    doc.event.coupleNames = "Charis & Jacob";
    expect(suggestedFilename(doc)).toBe(`charis-and-jacob${TROUSSEAU_EXTENSION}`);
  });

  it("falls back when there are no names yet", () => {
    expect(suggestedFilename(emptyTrousseau())).toBe(`wedding${TROUSSEAU_EXTENSION}`);
  });
});
