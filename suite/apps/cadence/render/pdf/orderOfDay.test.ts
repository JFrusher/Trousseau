import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import { renderContactSheet } from "./contactSheet";
import { nodeFontSource } from "./nodeFontSource";
import { renderOrderOfDay } from "./orderOfDay";
import { textOf } from "./readPdf";
import { mmToPt, PAGE_SIZES } from "./units";
import { PDFDocument } from "pdf-lib";

const options = { fontSource: nodeFontSource };

describe("renderOrderOfDay", () => {
  it("carries only the blocks that opted in", async () => {
    const doc = sampleDoc();
    const { text } = await textOf(await renderOrderOfDay(doc, options));

    for (const block of doc.blocks) {
      if (block.outputs.includes("order-of-day")) expect(text).toContain(block.label);
      else expect(text).not.toContain(block.label);
    }
  });

  it("says nothing operational", async () => {
    const { text } = await textOf(await renderOrderOfDay(sampleDoc(), options));
    expect(text).not.toContain("Registrar will not move this");
    expect(text).not.toContain("Eight groupings");
    expect(text).not.toContain("photographer");
    expect(text).not.toContain("spare");
  });

  it("is A5", async () => {
    const pdf = await PDFDocument.load(await renderOrderOfDay(sampleDoc(), options));
    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(mmToPt(PAGE_SIZES.A5.widthMm), 1);
    expect(page.getHeight()).toBeCloseTo(mmToPt(PAGE_SIZES.A5.heightMm), 1);
  });

  it("renders a day with nothing opted in", async () => {
    const doc = sampleDoc();
    const none = {
      ...doc,
      blocks: doc.blocks.map((block) => ({
        ...block,
        outputs: block.outputs.filter((output) => output !== "order-of-day"),
      })),
    };
    expect((await textOf(await renderOrderOfDay(none, options))).pages).toBe(1);
  });
});

describe("renderContactSheet", () => {
  it("lists every supplier that is on a block", async () => {
    const doc = sampleDoc();
    const { text } = await textOf(await renderContactSheet(doc, options));

    expect(text).toContain("Eleanor Vane Photography");
    expect(text).toContain("The Wrights");
    expect(text).toContain("07700 900272");
    expect(text).toContain("County Registrar");
  });

  it("still gives a row to a supplier whose details are not filled in", async () => {
    const doc = sampleDoc();
    const tagged = {
      ...doc,
      blocks: doc.blocks.map((block) =>
        block.id === "blk-cake" ? { ...block, tags: [...block.tags, "cake maker"] } : block,
      ),
    };
    const { text } = await textOf(await renderContactSheet(tagged, options));
    expect(text).toContain("cake maker");
    // The gap is the point: no phone, no arrival, both shown as missing.
    expect(text).toContain("—");
  });

  it("leaves out the tags the system uses to mark blocks", async () => {
    const { text } = await textOf(await renderContactSheet(sampleDoc(), options));
    // "photo" drives the golden-hour advisory; it is not somebody to ring.
    expect(text).not.toContain("photo");
  });

  it("lists suppliers by the name on the page, not the tag behind it", async () => {
    const { text } = await textOf(await renderContactSheet(sampleDoc(), options));
    const order = ["County Cars", "County Registrar", "Eleanor Vane Photography", "Ivy & Vane", "Smith & Doyle Catering", "The Wrights"];
    const positions = order.map((name) => text.indexOf(name));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("repeats the column headings when it runs onto a second page", async () => {
    const doc = sampleDoc();
    const many = {
      ...doc,
      blocks: doc.blocks.map((block, index) =>
        index === 0 ? { ...block, tags: Array.from({ length: 40 }, (_, i) => `supplier ${String(i).padStart(2, "0")}`) } : block,
      ),
    };
    const { text, pages } = await textOf(await renderContactSheet(many, options));
    expect(pages).toBeGreaterThan(1);
    expect(text.split("ARRIVES").length - 1).toBe(pages);
    expect(text).toContain("supplier 39");
    expect(text).toContain(`Page ${pages} of ${pages}`);
  });

  it("leaves out a detail whose blocks have gone", async () => {
    const doc = sampleDoc();
    const stripped = {
      ...doc,
      blocks: doc.blocks.map((block) => ({
        ...block,
        tags: block.tags.filter((tag) => tag !== "florist"),
      })),
    };
    const { text } = await textOf(await renderContactSheet(stripped, options));
    expect(text).not.toContain("Ivy & Vane");
  });
});
