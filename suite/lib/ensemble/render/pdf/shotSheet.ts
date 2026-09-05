// ponytail: imports Brigade's page/table/text/units/font kit rather than making
// a third near-copy of it (Cadence already carries a second). Promote the
// shared parts to lib/pdf/ if a fourth tool ever needs this kit.
import { PDFDocument, type PDFFont } from "pdf-lib";
import { embedFamily } from "@/apps/brigade/render/pdf/embedFonts";
import type { FontSource } from "@/apps/brigade/render/pdf/fontSource";
import { addSheet, hexColour, type Colour, type Sheet } from "@/apps/brigade/render/pdf/page";
import { paginate } from "@/apps/brigade/render/pdf/table";
import { wrap } from "@/apps/brigade/render/pdf/text";
import { contentBox, PAGE_SIZES, ptToMm } from "@/apps/brigade/render/pdf/units";
import type { Cast, CustomRole, Guest, Seating, ShotSection } from "@/lib/model/types";
import { resolveShot } from "@/lib/ensemble/resolve";

export interface ShotSheetOptions {
  fontSource: FontSource;
  pageSize?: "A4" | "A5";
  coupleNames?: string;
  generatedOn?: string;
}

const MARGIN_MM = 15;
const HEADER_MM = 16;
const FOOTER_MM = 10;
const ACCENT = "#46617a";
const BODY_PT = 9;
const SECTION_PT = 11;
const LEADING = 1.35;
const NO_COL_MM = 10;
const NOTES_COL_MM = 40;

const MUTED: Colour = { r: 0.44, g: 0.43, b: 0.41 };
const RULE: Colour = { r: 0.84, g: 0.83, b: 0.82 };
const DANGER: Colour = { r: 0.64, g: 0.23, b: 0.17 };

type Line =
  | { kind: "heading"; text: string; heightMm: number }
  | {
      kind: "shot";
      number: number;
      labelLines: string[];
      peopleLines: string[];
      notesLines: string[];
      trouble: boolean;
      heightMm: number;
    };

/** The whole shot list as one flowing document: section names as headings, shots numbered. */
export async function renderShotSheet(
  sections: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
  options: ShotSheetOptions,
  customRoles: CustomRole[] = [],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource("Lato"));
  const accent = hexColour(ACCENT);
  const size = PAGE_SIZES[options.pageSize ?? "A4"];
  const box = contentBox(size, MARGIN_MM);

  // Three columns share what the number and notes columns leave: label and
  // people split it evenly, less the two 4mm gutters between them.
  const labelColMm = (box.widthMm - NO_COL_MM - NOTES_COL_MM - 8) / 2;
  const peopleColMm = labelColMm;

  const lines: Line[] = [];
  let shotNumber = 0;

  for (const section of sections) {
    if (section.shots.length === 0) continue;
    lines.push({ kind: "heading", text: section.name, heightMm: ptToMm(SECTION_PT * LEADING) + 3 });

    for (const shot of section.shots) {
      shotNumber += 1;
      const resolved = resolveShot(shot, guests, seating, cast, customRoles);
      const labelLines = wrap(resolved.label, bold, BODY_PT, labelColMm);
      const peopleLines = wrap(resolved.people.map((p) => p.name).join(", ") || "—", regular, BODY_PT, peopleColMm);
      const notesLines = wrap(shot.notes, regular, BODY_PT, NOTES_COL_MM);
      const rowLines = Math.max(labelLines.length, peopleLines.length, notesLines.length, 1);
      lines.push({
        kind: "shot",
        number: shotNumber,
        labelLines,
        peopleLines,
        notesLines,
        trouble: resolved.problems.length > 0,
        heightMm: ptToMm(rowLines * BODY_PT * LEADING) + 2.4,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({ kind: "heading", text: "No shots planned yet.", heightMm: ptToMm(SECTION_PT * LEADING) + 3 });
  }

  const available = box.heightMm - HEADER_MM - FOOTER_MM;
  const pages = paginate(lines, available);

  pages.forEach((indices, pageIndex) => {
    const sheet = addSheet(pdf, size);
    const y0 = box.yMm;

    sheet.text(options.coupleNames || "Group shots", { xMm: box.xMm, yMm: y0 + 6, font: bold, sizePt: 14 });
    sheet.text(`Page ${pageIndex + 1} of ${pages.length}`, {
      xMm: box.xMm + box.widthMm,
      yMm: y0 + 6,
      font: regular,
      sizePt: 8,
      colour: MUTED,
      alignRight: true,
    });
    sheet.line(box.xMm, y0 + 9, box.xMm + box.widthMm, y0 + 9, { widthPt: 1, colour: accent });

    let y = y0 + HEADER_MM;
    for (const index of indices) {
      const line = lines[index];
      if (!line) continue;
      y = drawLine(sheet, line, {
        xMm: box.xMm,
        widthMm: box.widthMm,
        noWidthMm: NO_COL_MM,
        labelWidthMm: labelColMm,
        peopleWidthMm: peopleColMm,
        y,
        bold,
        regular,
      });
    }

    const footerY = size.heightMm - MARGIN_MM + 4;
    sheet.text(options.generatedOn ?? "", { xMm: box.xMm, yMm: footerY, font: regular, sizePt: 8, colour: MUTED });
  });

  return pdf.save();
}

function drawLine(
  sheet: Sheet,
  line: Line,
  context: {
    xMm: number;
    widthMm: number;
    noWidthMm: number;
    labelWidthMm: number;
    peopleWidthMm: number;
    y: number;
    bold: PDFFont;
    regular: PDFFont;
  },
): number {
  const lineHeightMm = ptToMm(BODY_PT * LEADING);

  if (line.kind === "heading") {
    sheet.text(line.text.toUpperCase(), {
      xMm: context.xMm,
      yMm: context.y + ptToMm(SECTION_PT),
      font: context.bold,
      sizePt: SECTION_PT,
    });
    return context.y + line.heightMm;
  }

  const noX = context.xMm;
  const labelX = context.xMm + context.noWidthMm;
  const peopleX = labelX + context.labelWidthMm + 4;
  const notesX = peopleX + context.peopleWidthMm + 4;

  sheet.text(`${line.number}.`, { xMm: noX, yMm: context.y + lineHeightMm, font: context.regular, sizePt: BODY_PT });

  const draw = (cellLines: string[], xMm: number, font: PDFFont) => {
    cellLines.forEach((text, i) => {
      if (!text) return;
      sheet.text(text, { xMm, yMm: context.y + lineHeightMm * (i + 1), font, sizePt: BODY_PT });
    });
  };
  draw(line.labelLines, labelX, context.bold);
  draw(line.peopleLines, peopleX, context.regular);
  draw(line.notesLines, notesX, context.regular);

  if (line.trouble) {
    sheet.rect(context.xMm - 3.5, context.y + 1.2, 1.4, lineHeightMm * 0.8, { colour: DANGER });
  }

  const bottom = context.y + line.heightMm;
  sheet.line(context.xMm, bottom - 1, context.xMm + context.widthMm, bottom - 1, { widthPt: 0.5, colour: RULE });
  return bottom;
}
