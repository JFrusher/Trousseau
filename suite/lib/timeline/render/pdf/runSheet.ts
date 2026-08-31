import { PDFDocument, type PDFFont } from "pdf-lib";
import { conflictsByBlock, conflicts as computeConflicts } from "../../core/schedule/conflicts";
import { resolve } from "../../core/schedule/resolve";
import { sunForDay } from "../../core/sun/solar";
import { tagLabel } from "../../core/model/tags";
import { isMoment, type Block, type TimelineDoc } from "../../core/model/types";
import { formatClock, formatDuration } from "../../core/time/minutes";
import { embedFamily } from "./embedFonts";
import type { FontSource } from "./fontSource";
import { addSheet, hexColour, type Sheet } from "./page";
import { columnOffsets, fitColumns, type Column } from "./table";
import { measureMm, truncate, wrap } from "./text";
import { contentBox, PAGE_SIZES, ptToMm } from "./units";

export interface SheetOptions {
  fontSource: FontSource;
  /** Only blocks carrying this tag. Absent means every block on the piece. */
  tag?: string;
  /** Sits under the couple's names — a supplier's name on a call sheet. */
  subtitle?: string;
  /** Shown in the footer beside the page numbers. */
  generatedOn?: string;
}

const MARGIN_MM = 15;
const GAP_MM = 3;
const LEADING = 1.35;

const COLUMNS: Column[] = [
  { key: "time", heading: "Time", widthMm: 20 },
  { key: "duration", heading: "For", widthMm: 14 },
  { key: "label", heading: "What", widthMm: 46 },
  { key: "location", heading: "Where", widthMm: 30 },
  { key: "who", heading: "Who", widthMm: 28 },
  { key: "notes", heading: "Notes", widthMm: 42 },
];

interface Cell {
  lines: string[];
  alignRight?: boolean;
}

interface Row {
  heightMm: number;
  cells: Cell[];
  trouble: boolean;
  startMin: number;
}

/**
 * The master run-sheet: every block that opts in, in clock order across all
 * lanes. Chronological rather than lane by lane, because the person holding it
 * is living the day in order, not reading a Gantt chart.
 */
export async function renderRunSheet(
  doc: TimelineDoc,
  options: SheetOptions,
): Promise<Uint8Array> {
  const style = doc.styles[options.tag === undefined ? "run-sheet" : "call-sheet"];
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource(style.fontFamily));

  const bodyPt = 9 * style.typeScale;
  const headPt = 8 * style.typeScale;
  const accent = hexColour(style.accentHex);
  const muted = { r: 0.44, g: 0.43, b: 0.41 };
  const danger = hexColour("#a33a2c");

  const size = PAGE_SIZES.A4;
  const box = contentBox(size, MARGIN_MM);
  const columns = fitColumns(COLUMNS, box.widthMm, GAP_MM);
  const offsets = columnOffsets(columns, box.xMm, GAP_MM);

  const positions = new Map(resolve(doc).map((entry) => [entry.id, entry]));
  const sun = sunForDay(doc.day);
  const trouble = conflictsByBlock(
    computeConflicts(
      resolve(doc),
      doc,
      sun?.goldenHourEndMin == null ? {} : { goldenHourEndMin: sun.goldenHourEndMin },
    ),
  );

  const output = options.tag === undefined ? "run-sheet" : "call-sheet";
  const chosen = doc.blocks
    .filter((block) => block.outputs.includes(output))
    .filter((block) => (options.tag === undefined ? true : block.tags.includes(options.tag)))
    .sort((a, b) => {
      const left = positions.get(a.id)?.startMin ?? 0;
      const right = positions.get(b.id)?.startMin ?? 0;
      return left === right ? a.lane.localeCompare(b.lane) : left - right;
    });

  const rows = chosen.map((block) =>
    measureRow(block, {
      doc,
      columns,
      font: regular,
      sizePt: bodyPt,
      positions,
      trouble: (trouble.get(block.id) ?? []).some((conflict) => conflict.severity === "conflict"),
    }),
  );

  const firstHeaderMm = 30;
  const laterHeaderMm = 16;
  const footerMm = 10;
  const columnHeadMm = ptToMm(headPt * LEADING) + 2;

  // Page one carries the full title block, so it holds fewer rows.
  const pages = paginateWithFirst(
    rows,
    box.heightMm - firstHeaderMm - columnHeadMm - footerMm,
    box.heightMm - laterHeaderMm - columnHeadMm - footerMm,
  );

  pages.forEach((indices, pageIndex) => {
    const sheet = addSheet(pdf, size);
    let y = box.yMm;

    if (pageIndex === 0) {
      sheet.text(doc.day.coupleNames || "The day", {
        xMm: box.xMm,
        yMm: y + 6,
        font: bold,
        sizePt: 17 * style.typeScale,
      });
      y += 11;
      const meta = [doc.day.venueName, formatDate(doc.day.date), options.subtitle]
        .filter(Boolean)
        .join("  ·  ");
      sheet.text(meta, { xMm: box.xMm, yMm: y + 3, font: regular, sizePt: bodyPt, colour: muted });
      y += 7;
      sheet.text(dayFooterLine(doc, sun?.sunsetMin ?? null), {
        xMm: box.xMm,
        yMm: y + 3,
        font: regular,
        sizePt: headPt,
        colour: muted,
      });
      y = box.yMm + firstHeaderMm;
    } else {
      sheet.text(`${doc.day.coupleNames || "The day"}${options.subtitle ? ` · ${options.subtitle}` : ""}`, {
        xMm: box.xMm,
        yMm: y + 4,
        font: regular,
        sizePt: headPt,
        colour: muted,
      });
      y = box.yMm + laterHeaderMm;
    }

    sheet.line(box.xMm, y - 2, box.xMm + box.widthMm, y - 2, {
      widthPt: Math.max(0.4, style.ruleWeightPt * 2),
      colour: accent,
    });

    columns.forEach((column, index) => {
      sheet.text(column.heading.toUpperCase(), {
        xMm: offsets[index] as number,
        yMm: y + ptToMm(headPt),
        font: bold,
        sizePt: headPt,
        colour: muted,
      });
    });
    y += columnHeadMm;

    for (const rowIndex of indices) {
      const row = rows[rowIndex];
      if (!row) continue;
      y = drawRow(sheet, row, {
        y,
        columns,
        offsets,
        regular,
        bold,
        sizePt: bodyPt,
        headPt,
        style,
        accent,
        muted,
        danger,
        boxRight: box.xMm + box.widthMm,
        boxLeft: box.xMm,
      });
    }

    const footerY = size.heightMm - MARGIN_MM + 4;
    sheet.text(options.generatedOn ?? "", {
      xMm: box.xMm,
      yMm: footerY,
      font: regular,
      sizePt: headPt,
      colour: muted,
    });
    sheet.text(`Page ${pageIndex + 1} of ${pages.length}`, {
      xMm: box.xMm + box.widthMm,
      yMm: footerY,
      font: regular,
      sizePt: headPt,
      colour: muted,
      alignRight: true,
    });
  });

  return pdf.save();
}

/** Page one is shorter than the rest; everything after it gets the full body. */
function paginateWithFirst(
  rows: Row[],
  firstHeightMm: number,
  laterHeightMm: number,
): number[][] {
  if (rows.length === 0) return [[]];

  let used = 0;
  let current: number[] = [];
  const pages: number[][] = [];

  rows.forEach((row, index) => {
    const available = pages.length === 0 ? firstHeightMm : laterHeightMm;
    if (current.length > 0 && used + row.heightMm > available) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += row.heightMm;
  });

  if (current.length > 0) pages.push(current);
  return pages;
}

interface MeasureContext {
  doc: TimelineDoc;
  columns: Column[];
  font: PDFFont;
  sizePt: number;
  positions: Map<string, { startMin: number; endMin: number; contentEndMin: number }>;
  trouble: boolean;
}

function measureRow(block: Block, context: MeasureContext): Row {
  const entry = context.positions.get(block.id);
  const startMin = entry?.startMin ?? 0;

  const who = block.tags.map((tag) => tagLabel(context.doc, tag)).join(", ");
  const values: Record<string, string> = {
    time: entry ? formatClock(startMin) : "--:--",
    // The squeezed length, not the typed one: the sheet must agree with its own
    // clock. A moment has no length to print, so it says what it is instead.
    duration: isMoment(block)
      ? "moment"
      : formatDuration(entry ? entry.contentEndMin - entry.startMin : block.durationMin),
    label: block.label,
    location: block.location,
    who,
    notes: [block.notes, block.bufferMin > 0 ? `+${block.bufferMin}m spare` : ""]
      .filter(Boolean)
      .join(" · "),
  };

  const cells: Cell[] = context.columns.map((column) => {
    const value = values[column.key] ?? "";
    // Times and durations must never wrap; they are the spine of the sheet.
    if (column.key === "time" || column.key === "duration") {
      return { lines: [truncate(value, context.font, context.sizePt, column.widthMm)] };
    }
    return { lines: wrap(value, context.font, context.sizePt, column.widthMm) };
  });

  const lines = Math.max(...cells.map((cell) => cell.lines.length));

  return {
    cells,
    trouble: context.trouble,
    startMin,
    heightMm: ptToMm(lines * context.sizePt * LEADING) + 2.6,
  };
}

interface DrawContext {
  y: number;
  columns: Column[];
  offsets: number[];
  regular: PDFFont;
  bold: PDFFont;
  sizePt: number;
  headPt: number;
  style: TimelineDoc["styles"][keyof TimelineDoc["styles"]];
  accent: { r: number; g: number; b: number };
  muted: { r: number; g: number; b: number };
  danger: { r: number; g: number; b: number };
  boxLeft: number;
  boxRight: number;
}

function drawRow(sheet: Sheet, row: Row, context: DrawContext): number {
  const { y, columns, offsets, regular, bold, sizePt } = context;
  const lineHeightMm = ptToMm(sizePt * LEADING);

  columns.forEach((column, index) => {
    const cell = row.cells[index];
    if (!cell) return;
    cell.lines.forEach((line, lineIndex) => {
      if (line === "") return;
      sheet.text(line, {
        xMm: offsets[index] as number,
        yMm: y + lineHeightMm * (lineIndex + 1) - 0.8,
        font: column.key === "label" ? bold : regular,
        sizePt,
        colour:
          column.key === "notes" || column.key === "who" || column.key === "location"
            ? context.muted
            : row.trouble && column.key === "time"
              ? context.danger
              : { r: 0, g: 0, b: 0 },
      });
    });
  });

  if (row.trouble) {
    // A mark in the margin, so a clash is visible with the sheet at arm's length.
    sheet.rect(context.boxLeft - 3.5, y + 1.4, 1.4, lineHeightMm * 0.8, { colour: context.danger });
  }

  const bottom = y + row.heightMm;
  sheet.line(context.boxLeft, bottom - 1, context.boxRight, bottom - 1, {
    widthPt: context.style.ruleWeightPt,
    colour: { r: 0.84, g: 0.83, b: 0.82 },
  });

  return bottom;
}

function dayFooterLine(doc: TimelineDoc, sunsetMin: number | null): string {
  const parts = [`Curfew ${formatClock(doc.day.curfewMin)}`];
  if (sunsetMin !== null) parts.push(`sunset ${formatClock(sunsetMin)}`);
  return parts.join("  ·  ");
}

function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export { measureMm };
