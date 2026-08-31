import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { assemblePack } from "./weddingPack";

/**
 * The merge is the whole of this module, and the two things it must get right
 * are the order and the count. A pack whose sections came out shuffled is worse
 * than three separate downloads, because it looks like it worked.
 */

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("the wedding pack", () => {
  it("keeps every page, in the order the sections were given", async () => {
    const pack = await assemblePack([
      { title: "The room", bytes: await pdfOf(1) },
      { title: "The day", bytes: await pdfOf(3) },
      { title: "The jobs", bytes: await pdfOf(2) },
    ]);

    expect(pack.contents).toEqual([
      { title: "The room", pages: 1 },
      { title: "The day", pages: 3 },
      { title: "The jobs", pages: 2 },
    ]);

    const merged = await PDFDocument.load(pack.bytes as unknown as ArrayBuffer);
    expect(merged.getPageCount()).toBe(6);
  });

  it("produces a readable PDF from a single section", async () => {
    const pack = await assemblePack([{ title: "The day", bytes: await pdfOf(2) }]);
    const merged = await PDFDocument.load(pack.bytes as unknown as ArrayBuffer);

    expect(merged.getPageCount()).toBe(2);
    expect(merged.getTitle()).toBe("Wedding pack");
  });

  it("does not fall over when there is nothing to print", async () => {
    // A PDF with no pages is not a valid PDF — pdf-lib reads one back out of
    // what it just wrote — so deciding an empty pack is not worth offering is
    // the caller's job, and it does that before ever getting here. All this has
    // to do is not throw on the way.
    const pack = await assemblePack([]);
    expect(pack.contents).toEqual([]);
  });
});
