import { PDFDocument } from "pdf-lib";
import { usedTags } from "../../core/model/tags";
import type { TimelineDoc } from "../../core/model/types";
import { PHOTO_TAG } from "../../core/schedule/conflicts";
import { formatClock } from "../../core/time/minutes";
import { embedFamily } from "./embedFonts";
import type { FontSource } from "./fontSource";
import { addSheet, hexColour, type Sheet } from "./page";
import { columnOffsets, fitColumns, type Column } from "./table";
import { truncate, wrap } from "./text";
import { contentBox, PAGE_SIZES, ptToMm } from "./units";

export interface ContactSheetOptions {
  fontSource: FontSource;
  generatedOn?: string;
}

const MARGIN_MM = 15;
const GAP_MM = 4;
const FOOTER_MM = 10;
/** Air between a row's baseline and the rule under it. */
const ROW_PADDING_MM = 3.4;

const COLUMNS: Column[] = [
  { key: "who", heading: "Who", widthMm: 50 },
  { key: "phone", heading: "Phone", widthMm: 34 },
  { key: "arrives", heading: "Arrives", widthMm: 20 },
  { key: "notes", heading: "Notes", widthMm: 76 },
];

/**
 * Tags the system uses to mark blocks rather than to name a person. They drive
 * behaviour — `photo` marks photography for the golden-hour advisory — and
 * printing them in a list of who to ring is noise.
 */
const MARKER_TAGS = new Set<string>([PHOTO_TAG]);

interface Contact {
  name: string;
  phone: string;
  arrives: string;
  notes: string;
}

/**
 * One page or more, every supplier, in the order the reader sees them: by name.
 * A supplier with no phone number still gets a row, because the gap is the
 * point — that is the number nobody has yet.
 */
export async function renderContactSheet(
  doc: TimelineDoc,
  options: ContactSheetOptions,
): Promise<Uint8Array> {
  const style = doc.styles["contact-sheet"];
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource(style.fontFamily));

  const size = PAGE_SIZES.A4;
  const box = contentBox(size, MARGIN_MM);
  const columns = fitColumns(COLUMNS, box.widthMm, GAP_MM);
  const offsets = columnOffsets(columns, box.xMm, GAP_MM);
  const accent = hexColour(style.accentHex);
  const muted = { r: 0.44, g: 0.43, b: 0.41 };
  const hairline = { r: 0.84, g: 0.83, b: 0.82 };

  const bodyPt = 10 * style.typeScale;
  const headPt = 8 * style.typeScale;
  const lineMm = ptToMm(bodyPt * 1.35);
  const notesWidthMm = columns[3]?.widthMm ?? 60;

  const contacts: Contact[] = usedTags(doc)
    .filter((summary) => !MARKER_TAGS.has(summary.tag))
    .map((summary) => ({
      name: summary.detail?.displayName || summary.tag,
      phone: summary.detail?.phone || "—",
      arrives: summary.detail?.arrivalMin == null ? "—" : formatClock(summary.detail.arrivalMin),
      notes: summary.detail?.notes ?? "",
    }))
    // Sorted by what the reader can actually see. Sorting by the underlying tag
    // while printing display names looks like no order at all.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const bottomMm = box.yMm + box.heightMm - FOOTER_MM;

  const sheets: Sheet[] = [];
  let sheet = addSheet(pdf, size);
  sheets.push(sheet);
  let y = drawTitle(sheet, doc, box.xMm, box.yMm, { bold, regular, style, muted, bodyPt: headPt });
  y = drawHeadings(sheet, columns, offsets, y, {
    bold,
    headPt,
    lineMm,
    accent,
    muted,
    hairline,
    left: box.xMm,
    right: box.xMm + box.widthMm,
    ruleWeightPt: style.ruleWeightPt,
  });

  for (const contact of contacts) {
    const noteLines = contact.notes === "" ? [] : wrap(contact.notes, regular, bodyPt, notesWidthMm);
    const heightMm = Math.max(1, noteLines.length) * lineMm + ROW_PADDING_MM;

    if (y + heightMm > bottomMm) {
      sheet = addSheet(pdf, size);
      sheets.push(sheet);
      y = drawHeadings(sheet, columns, offsets, box.yMm + 4, {
        bold,
        headPt,
        lineMm,
        accent,
        muted,
        hairline,
        left: box.xMm,
        right: box.xMm + box.widthMm,
        ruleWeightPt: style.ruleWeightPt,
      });
    }

    const baseline = y + lineMm - 1;
    const cells = [
      truncate(contact.name, bold, bodyPt, columns[0]?.widthMm ?? 40),
      contact.phone,
      contact.arrives,
    ];

    cells.forEach((value, index) => {
      sheet.text(value, {
        xMm: offsets[index] as number,
        yMm: baseline,
        font: index === 0 ? bold : regular,
        sizePt: bodyPt,
        colour: value === "—" ? muted : { r: 0, g: 0, b: 0 },
      });
    });

    noteLines.forEach((line, index) => {
      if (line === "") return;
      sheet.text(line, {
        xMm: offsets[3] as number,
        yMm: baseline + lineMm * index,
        font: regular,
        sizePt: bodyPt,
        colour: muted,
      });
    });

    y += heightMm;
    sheet.line(box.xMm, y - 1.2, box.xMm + box.widthMm, y - 1.2, {
      widthPt: style.ruleWeightPt,
      colour: hairline,
    });
  }

  if (contacts.length === 0) {
    sheet.text("No suppliers are tagged on any block yet.", {
      xMm: box.xMm,
      yMm: y + lineMm,
      font: regular,
      sizePt: bodyPt,
      colour: muted,
    });
  }

  // Footers last, so they land on every page this render produced.
  sheets.forEach((footer, index) => {
    const footerY = size.heightMm - MARGIN_MM + 4;
    if (options.generatedOn) {
      footer.text(options.generatedOn, {
        xMm: box.xMm,
        yMm: footerY,
        font: regular,
        sizePt: headPt,
        colour: muted,
      });
    }
    if (sheets.length > 1) {
      footer.text(`Page ${index + 1} of ${sheets.length}`, {
        xMm: box.xMm + box.widthMm,
        yMm: footerY,
        font: regular,
        sizePt: headPt,
        colour: muted,
        alignRight: true,
      });
    }
  });

  return pdf.save();
}

interface TitleContext {
  bold: Parameters<Sheet["text"]>[1]["font"];
  regular: Parameters<Sheet["text"]>[1]["font"];
  style: TimelineDoc["styles"][keyof TimelineDoc["styles"]];
  muted: { r: number; g: number; b: number };
  bodyPt: number;
}

/** Returns the y the table may start at. */
function drawTitle(
  sheet: Sheet,
  doc: TimelineDoc,
  leftMm: number,
  topMm: number,
  context: TitleContext,
): number {
  let y = topMm + 6;
  sheet.text(`${doc.day.coupleNames || "The day"} — who to ring`, {
    xMm: leftMm,
    yMm: y,
    font: context.bold,
    sizePt: 15 * context.style.typeScale,
  });

  y += 6;
  const meta = [doc.day.venueName, doc.day.date].filter(Boolean).join("  ·  ");
  if (meta !== "") {
    sheet.text(meta, {
      xMm: leftMm,
      yMm: y,
      font: context.regular,
      sizePt: context.bodyPt,
      colour: context.muted,
    });
  }

  return y + 6;
}

interface HeadContext {
  bold: Parameters<Sheet["text"]>[1]["font"];
  headPt: number;
  lineMm: number;
  accent: { r: number; g: number; b: number };
  muted: { r: number; g: number; b: number };
  hairline: { r: number; g: number; b: number };
  left: number;
  right: number;
  ruleWeightPt: number;
}

/**
 * The column band: a heavier rule above, the headings, a hairline below. The
 * headings need to belong to the table under them, not to the title above.
 */
function drawHeadings(
  sheet: Sheet,
  columns: Column[],
  offsets: number[],
  topMm: number,
  context: HeadContext,
): number {
  sheet.line(context.left, topMm, context.right, topMm, {
    widthPt: Math.max(0.4, context.ruleWeightPt * 2),
    colour: context.accent,
  });

  const baseline = topMm + ptToMm(context.headPt) + 2;
  columns.forEach((column, index) => {
    sheet.text(column.heading.toUpperCase(), {
      xMm: offsets[index] as number,
      yMm: baseline,
      font: context.bold,
      sizePt: context.headPt,
      colour: context.muted,
    });
  });

  const bottom = baseline + 2.2;
  sheet.line(context.left, bottom, context.right, bottom, {
    widthPt: context.ruleWeightPt,
    colour: context.hairline,
  });

  return bottom + 1.5;
}
