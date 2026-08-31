import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

export interface FontBytes {
  family: string;
  data: Uint8Array;
  bold?: Uint8Array;
}

export interface EmbeddedFonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Families that had to go in whole because subsetting failed. */
  notSubset: string[];
}

/**
 * Embeds a family once per document, subset. Subsetting is what keeps a
 * run-sheet a few hundred kilobytes instead of a few megabytes; a face that
 * refuses to subset goes in whole, because a large PDF beats a failed export.
 */
export async function embedFamily(pdf: PDFDocument, font: FontBytes): Promise<EmbeddedFonts> {
  pdf.registerFontkit(fontkit);
  const notSubset: string[] = [];

  const embed = async (data: Uint8Array): Promise<PDFFont> => {
    try {
      return await pdf.embedFont(data, { subset: true });
    } catch {
      notSubset.push(font.family);
      return pdf.embedFont(data, { subset: false });
    }
  };

  const regular = await embed(font.data);
  const bold = font.bold ? await embed(font.bold) : regular;
  return { regular, bold, notSubset };
}
