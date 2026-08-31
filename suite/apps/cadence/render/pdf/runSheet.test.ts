import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import { callSheetTags, renderAllCallSheets, renderCallSheet } from "./callSheet";
import { nodeFontSource } from "./nodeFontSource";
import { renderRunSheet } from "./runSheet";
import { textOf } from "./readPdf";

const options = { fontSource: nodeFontSource, generatedOn: "Generated for the test" };

describe("renderRunSheet", () => {
  it("puts every opted-in block on the sheet, once", async () => {
    const doc = sampleDoc();
    const { text, pages } = await textOf(await renderRunSheet(doc, options));

    expect(pages).toBeGreaterThanOrEqual(1);
    for (const block of doc.blocks.filter((entry) => entry.outputs.includes("run-sheet"))) {
      const occurrences = text.split(block.label).length - 1;
      expect(occurrences, `${block.label} appears ${occurrences} times`).toBe(1);
    }
  });

  it("prints the first block's clock time and the couple's names", async () => {
    const { text } = await textOf(await renderRunSheet(sampleDoc(), options));
    expect(text).toContain("Charis & Jacob");
    expect(text).toContain("Vane House");
    // Florist install is anchored at 07:00 and sorts first.
    expect(text).toContain("07:00");
  });

  it("prints a squeezed block at the length it actually runs", async () => {
    const doc = sampleDoc();
    const squeezed = {
      ...doc,
      blocks: doc.blocks.map((block) =>
        block.id === "blk-drinks"
          ? { ...block, durationMin: 135, squeezeToMin: 75 }
          : block,
      ),
    };
    const { text } = await textOf(await renderRunSheet(squeezed, options));
    // Typed as 2h 15m, squeezed to 1h 45m by the anchor that follows it.
    expect(text).toContain("1h 45m");
    expect(text).not.toContain("2h 15m");
  });

  it("prints a moment with no length to it", async () => {
    const { text } = await textOf(await renderRunSheet(sampleDoc(), options));
    expect(text).toContain("Rings to the best man");
    expect(text).toContain("moment");
  });

  it("repeats the page furniture on every page", async () => {
    const doc = sampleDoc();
    const many = {
      ...doc,
      blocks: Array.from({ length: 120 }, (_, index) => ({
        ...(doc.blocks[index % doc.blocks.length] as (typeof doc.blocks)[number]),
        id: `blk-copy-${index}`,
        label: `Block copy ${index}`,
      })),
    };
    const { text, pages } = await textOf(await renderRunSheet(many, options));
    expect(pages).toBeGreaterThan(2);
    expect(text.split("Page ").length - 1).toBe(pages);
    expect(text).toContain(`Page ${pages} of ${pages}`);
  });

  it("renders an empty day without falling over", async () => {
    const doc = { ...sampleDoc(), blocks: [] };
    const { pages } = await textOf(await renderRunSheet(doc, options));
    expect(pages).toBe(1);
  });

  it("embeds the font as a subset rather than outlining the text", async () => {
    const loaded = await PDFDocument.load(await renderRunSheet(sampleDoc(), options));
    let embedded = 0;
    const families: string[] = [];
    for (const [, object] of loaded.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      if (object.has(PDFName.of("FontFile2"))) embedded += 1;
      const base = object.get(PDFName.of("BaseFont"));
      if (base) families.push(String(base));
    }
    expect(embedded).toBeGreaterThan(0);
    expect(families.join(" ")).toContain("Lato");
  });
});

describe("renderCallSheet", () => {
  it("carries only that supplier's blocks", async () => {
    const doc = sampleDoc();
    const { text } = await textOf(await renderCallSheet(doc, "band", options));

    expect(text).toContain("First dance");
    expect(text).toContain("Band, first set");
    expect(text).not.toContain("Bridal preparations");
    expect(text).not.toContain("Florist install");
  });

  it("heads the sheet with the supplier, their arrival and their number", async () => {
    const { text } = await textOf(await renderCallSheet(sampleDoc(), "band", options));
    expect(text).toContain("The Wrights");
    expect(text).toContain("18:00");
    expect(text).toContain("07700 900272");
  });

  it("bundles every supplier, page for page", async () => {
    const doc = sampleDoc();
    const tags = callSheetTags(doc);
    expect(tags.length).toBeGreaterThan(3);

    let separate = 0;
    for (const tag of tags) {
      separate += (await textOf(await renderCallSheet(doc, tag, options))).pages;
    }
    const bundled = await textOf(await renderAllCallSheets(doc, options));
    expect(bundled.pages).toBe(separate);
  });
});
