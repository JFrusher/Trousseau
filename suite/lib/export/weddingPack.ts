import { PDFDocument } from "pdf-lib";

/**
 * Everything you carry on the day, as one document.
 *
 * The floor plan, the run sheet, the job list and the shot list are made by four
 * different tools, in two different PDF libraries, and were four separate
 * downloads you had to remember to take. On the morning itself that is four
 * chances to be holding a version of one of them from last Tuesday.
 *
 * So they are printed together, in the order you would want them in a binder:
 * what the room looks like, what happens when, who is doing what, and who to
 * photograph.
 *
 * The place cards are deliberately not here. They print on 85×55 card stock
 * through a sheet layout of their own, and an A4 binder and a tray of card are
 * two different trips to the printer — folding them together would produce a
 * document that cannot be printed in one go by anyone.
 *
 * Merging rather than rewriting: Tableaux draws its plan with jsPDF because it
 * needs SVG, the other three use pdf-lib. Porting one to the other would be a
 * week of work to produce the same pages, so each section is made by whatever
 * already makes it well and the results are stapled together here.
 */

export interface PackSection {
  title: string;
  bytes: Uint8Array;
}

export interface Pack {
  bytes: Uint8Array;
  /** What went in, in order, with page counts — so the caller can say. */
  contents: Array<{ title: string; pages: number }>;
}

/**
 * Staples the sections together, in the order given.
 *
 * A section that fails to render is left out rather than taking the whole pack
 * down with it: a run sheet you cannot produce is a reason to fix the run
 * sheet, not a reason to be standing at the printer with nothing at all.
 */
export async function assemblePack(sections: PackSection[]): Promise<Pack> {
  const pack = await PDFDocument.create();
  const contents: Array<{ title: string; pages: number }> = [];

  for (const section of sections) {
    const source = await PDFDocument.load(section.bytes as unknown as ArrayBuffer);
    const pages = await pack.copyPages(source, source.getPageIndices());
    for (const page of pages) pack.addPage(page);
    contents.push({ title: section.title, pages: pages.length });
  }

  pack.setTitle("Wedding pack");
  pack.setProducer("Trousseau");

  return { bytes: await pack.save(), contents };
}
