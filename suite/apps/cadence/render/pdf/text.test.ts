import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { measureMm, truncate, wrap } from "./text";

let font: PDFFont;

beforeAll(async () => {
  const pdf = await PDFDocument.create();
  font = await pdf.embedFont(StandardFonts.Helvetica);
});

describe("wrap", () => {
  it("never lets a line exceed the bound", () => {
    const lines = wrap(
      "The wedding breakfast is served in the great hall, with speeches to follow at four",
      font,
      10,
      50,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measureMm(line, font, 10)).toBeLessThanOrEqual(50);
  });

  it("breaks a word that is wider than the column rather than overflowing", () => {
    const lines = wrap("Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", font, 10, 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measureMm(line, font, 10)).toBeLessThanOrEqual(20);
  });

  it("keeps a short string on one line", () => {
    expect(wrap("Ceremony", font, 10, 80)).toEqual(["Ceremony"]);
  });

  it("returns one empty line for empty input", () => {
    expect(wrap("", font, 10, 50)).toEqual([""]);
  });

  it("loses no words", () => {
    const source = "Group photographs on the lawn, eight groupings, list with the photographer";
    expect(wrap(source, font, 9, 40).join(" ").split(/\s+/)).toEqual(source.split(/\s+/));
  });
});

describe("truncate", () => {
  it("leaves a string that fits alone", () => {
    expect(truncate("Ceremony", font, 10, 80)).toBe("Ceremony");
  });

  it("cuts with an ellipsis and stays inside the bound", () => {
    const cut = truncate("Bridal preparations in the east wing suite", font, 10, 30);
    expect(cut.endsWith("…")).toBe(true);
    expect(measureMm(cut, font, 10)).toBeLessThanOrEqual(30);
  });

  it("copes with a bound too small for anything", () => {
    expect(truncate("Ceremony", font, 10, 0.1)).toBe("");
  });
});
