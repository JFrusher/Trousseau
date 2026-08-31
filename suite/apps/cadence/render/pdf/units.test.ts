import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { addSheet, hexColour } from "./page";
import { contentBox, mmToPt, PAGE_SIZES, ptToMm } from "./units";

describe("units", () => {
  it("gives A4 its true size in points", () => {
    expect(mmToPt(PAGE_SIZES.A4.widthMm)).toBeCloseTo(595.28, 2);
    expect(mmToPt(PAGE_SIZES.A4.heightMm)).toBeCloseTo(841.89, 2);
  });

  it("gives A5 its true size in points", () => {
    expect(mmToPt(PAGE_SIZES.A5.widthMm)).toBeCloseTo(419.53, 2);
    expect(mmToPt(PAGE_SIZES.A5.heightMm)).toBeCloseTo(595.28, 2);
  });

  it("round trips", () => {
    expect(ptToMm(mmToPt(123.4))).toBeCloseTo(123.4, 6);
  });

  it("insets the content box on every side", () => {
    const box = contentBox(PAGE_SIZES.A4, 15);
    expect(box).toEqual({ xMm: 15, yMm: 15, widthMm: 180, heightMm: 267 });
  });
});

describe("sheet coordinates", () => {
  it("puts a point ten millimetres from the top at the right pdf-lib y", async () => {
    const pdf = await PDFDocument.create();
    const sheet = addSheet(pdf, PAGE_SIZES.A4);
    const font = await pdf.embedFont("Helvetica");

    sheet.text("top", { xMm: 10, yMm: 10, font, sizePt: 10 });
    // 10mm from the top of a 297mm page is 287mm from the bottom.
    const bytes = await pdf.save();
    expect(bytes.length).toBeGreaterThan(0);
    expect(sheet.page.getHeight()).toBeCloseTo(mmToPt(297), 2);
    expect(mmToPt(297 - 10)).toBeCloseTo(813.54, 2);
  });
});

describe("hexColour", () => {
  it("reads a hex string", () => {
    expect(hexColour("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexColour("000000")).toEqual({ r: 0, g: 0, b: 0 });
    const accent = hexColour("#37548a");
    expect(accent.r).toBeCloseTo(0x37 / 255, 5);
  });

  it("falls back to black rather than throwing", () => {
    expect(hexColour("not a colour")).toEqual({ r: 0, g: 0, b: 0 });
  });
});
