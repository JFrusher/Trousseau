import { PDFDocument, type PDFFont } from "pdf-lib";
import { assigneeNames, blockFor, type BrigadeDoc, type Job } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import { embedFamily } from "./embedFonts";
import type { FontSource } from "./fontSource";
import { addSheet, hexColour, type Colour, type Sheet } from "./page";
import { columnOffsets, fitColumns, type Column } from "./table";
import { truncate, wrap } from "./text";
import { contentBox, PAGE_SIZES, ptToMm } from "./units";

export interface SheetOptions {
  fontSource: FontSource;
  /** Shown in the footer beside the page numbers. */
  generatedOn?: string;
}

const MARGIN_MM = 15;
const GAP_MM = 3;
const LEADING = 1.35;
const FONT_FAMILY = "Lato";
const ACCENT = "#37548a";
const BODY_PT = 9;
const HEAD_PT = 8;

const MUTED: Colour = { r: 0.44, g: 0.43, b: 0.41 };
const RULE: Colour = { r: 0.84, g: 0.83, b: 0.82 };
const DANGER: Colour = { r: 0.64, g: 0.23, b: 0.17 };

/** The master list: every job on the day, in the order the day happens. */
const MASTER: Column[] = [
  { key: "time", heading: "Time", widthMm: 18 },
  { key: "label", heading: "Job", widthMm: 46 },
  { key: "location", heading: "Where", widthMm: 28 },
  { key: "who", heading: "Who", widthMm: 34 },
  { key: "during", heading: "During", widthMm: 32 },
  { key: "notes", heading: "Notes", widthMm: 30 },
];

/** One person's or one team's own sheet: they know who they are. */
const OWN: Column[] = [
  { key: "time", heading: "Time", widthMm: 18 },
  { key: "label", heading: "Job", widthMm: 52 },
  { key: "location", heading: "Where", widthMm: 32 },
  { key: "during", heading: "During", widthMm: 38 },
  { key: "notes", heading: "Notes", widthMm: 40 },
];

/** A team's sheet keeps the Who column: the team wants to see its own names. */
const TEAM: Column[] = [
  { key: "time", heading: "Time", widthMm: 18 },
  { key: "label", heading: "Job", widthMm: 46 },
  { key: "location", heading: "Where", widthMm: 28 },
  { key: "who", heading: "Who", widthMm: 32 },
  { key: "during", heading: "During", widthMm: 34 },
  { key: "notes", heading: "Notes", widthMm: 30 },
];

interface Row {
  cells: { lines: string[] }[];
  heightMm: number;
  /** The job's block has gone from the day: printed, and marked in the margin. */
  trouble: boolean;
}

interface Piece {
  title: string;
  subtitle: string;
  columns: Column[];
  jobs: Job[];
}

/** Every job on the day, whoever holds it — the coordinator's copy. */
export async function renderJobList(
  doc: BrigadeDoc,
  options: SheetOptions,
): Promise<Uint8Array> {
  return renderPieces(
    doc,
    [
      {
        title: doc.day?.coupleNames || "The day",
        subtitle: [doc.day?.venueName, formatDate(doc.day?.date ?? ""), "Job list"]
          .filter(Boolean)
          .join("  ·  "),
        columns: MASTER,
        jobs: inDayOrder(doc, doc.jobs),
      },
    ],
    options,
  );
}

/** One person's jobs, in clock order. What you hand them when they arrive. */
export async function renderPersonSheet(
  doc: BrigadeDoc,
  personId: string,
  options: SheetOptions,
): Promise<Uint8Array> {
  return renderPieces(doc, [personPiece(doc, personId)], options);
}

/** Everyone who has work, a page each, in one PDF. */
export async function renderAllPersonSheets(
  doc: BrigadeDoc,
  options: SheetOptions,
): Promise<Uint8Array> {
  const pieces = peopleWithJobs(doc).map((id) => personPiece(doc, id));
  return renderPieces(doc, pieces, options);
}

/** One team's work, whoever in it holds each job. */
export async function renderAllTeamSheets(
  doc: BrigadeDoc,
  options: SheetOptions,
): Promise<Uint8Array> {
  const pieces = doc.teams
    .map((team) => ({
      title: team.name,
      subtitle: [team.phone, doc.day?.coupleNames, formatDate(doc.day?.date ?? "")]
        .filter(Boolean)
        .join("  ·  "),
      columns: TEAM,
      jobs: inDayOrder(doc, jobsForTeam(doc, team.id)),
    }))
    .filter((piece) => piece.jobs.length > 0);

  return renderPieces(doc, pieces, options);
}

/** People with at least one job, in the order the document holds them. */
export function peopleWithJobs(doc: BrigadeDoc): string[] {
  return doc.people
    .filter((person) => doc.jobs.some((job) => job.personIds.includes(person.id)))
    .map((person) => person.id);
}

/**
 * A team's work: the jobs put on the team itself, and the jobs its members
 * hold. A person lent to another team for a job takes that job with them.
 */
export function jobsForTeam(doc: BrigadeDoc, teamId: string): Job[] {
  const members = new Set(
    doc.people.filter((person) => person.teamId === teamId).map((person) => person.id),
  );
  return doc.jobs.filter(
    (job) => job.teamId === teamId || job.personIds.some((id) => members.has(id)),
  );
}

function personPiece(doc: BrigadeDoc, personId: string): Piece {
  const person = doc.people.find((entry) => entry.id === personId);
  const team = doc.teams.find((entry) => entry.id === person?.teamId);
  return {
    title: person?.name ?? "Unknown",
    subtitle: [team?.name, doc.day?.coupleNames, formatDate(doc.day?.date ?? "")]
      .filter(Boolean)
      .join("  ·  "),
    columns: OWN,
    jobs: inDayOrder(
      doc,
      doc.jobs.filter((job) => job.personIds.includes(personId)),
    ),
  };
}

/**
 * Jobs in the order the day happens. A job whose block has gone has no time to
 * sort by, so it goes last rather than to midnight — the sheet still carries
 * it, because work nobody has re-hung is exactly what needs finding.
 */
function inDayOrder(doc: BrigadeDoc, jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const left = blockFor(doc, a);
    const right = blockFor(doc, b);
    if (!left || !right) return left ? -1 : right ? 1 : a.label.localeCompare(b.label);
    if (left.startMin !== right.startMin) return left.startMin - right.startMin;
    if (left.id !== right.id) return left.label.localeCompare(right.label);
    return a.label.localeCompare(b.label);
  });
}

/** Every piece into one document, each starting on a fresh page. */
async function renderPieces(
  doc: BrigadeDoc,
  pieces: Piece[],
  options: SheetOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource(FONT_FAMILY));
  const accent = hexColour(ACCENT);

  const size = PAGE_SIZES.A4;
  const box = contentBox(size, MARGIN_MM);

  if (pieces.length === 0) pdf.addPage([595, 842]);

  for (const piece of pieces) {
    const columns = fitColumns(piece.columns, box.widthMm, GAP_MM);
    const offsets = columnOffsets(columns, box.xMm, GAP_MM);
    const rows = piece.jobs.map((job) => measureRow(doc, job, columns, regular));

    const firstHeaderMm = 26;
    const laterHeaderMm = 14;
    const footerMm = 10;
    const columnHeadMm = ptToMm(HEAD_PT * LEADING) + 2;

    const pages = paginate(
      rows,
      box.heightMm - firstHeaderMm - columnHeadMm - footerMm,
      box.heightMm - laterHeaderMm - columnHeadMm - footerMm,
    );

    pages.forEach((indices, pageIndex) => {
      const sheet = addSheet(pdf, size);
      let y = box.yMm;

      if (pageIndex === 0) {
        sheet.text(piece.title, {
          xMm: box.xMm,
          yMm: y + 6,
          font: bold,
          sizePt: 16,
        });
        sheet.text(piece.subtitle, {
          xMm: box.xMm,
          yMm: y + 12,
          font: regular,
          sizePt: BODY_PT,
          colour: MUTED,
        });
        y = box.yMm + firstHeaderMm;
      } else {
        sheet.text(`${piece.title} · ${piece.subtitle}`, {
          xMm: box.xMm,
          yMm: y + 4,
          font: regular,
          sizePt: HEAD_PT,
          colour: MUTED,
        });
        y = box.yMm + laterHeaderMm;
      }

      sheet.line(box.xMm, y - 2, box.xMm + box.widthMm, y - 2, { widthPt: 1, colour: accent });

      columns.forEach((column, index) => {
        sheet.text(column.heading.toUpperCase(), {
          xMm: offsets[index] as number,
          yMm: y + ptToMm(HEAD_PT),
          font: bold,
          sizePt: HEAD_PT,
          colour: MUTED,
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
          boxLeft: box.xMm,
          boxRight: box.xMm + box.widthMm,
        });
      }

      if (indices.length === 0) {
        sheet.text("Nothing on this sheet yet.", {
          xMm: box.xMm,
          yMm: y + 6,
          font: regular,
          sizePt: BODY_PT,
          colour: MUTED,
        });
      }

      const footerY = size.heightMm - MARGIN_MM + 4;
      sheet.text(options.generatedOn ?? "", {
        xMm: box.xMm,
        yMm: footerY,
        font: regular,
        sizePt: HEAD_PT,
        colour: MUTED,
      });
      sheet.text(`Page ${pageIndex + 1} of ${pages.length}`, {
        xMm: box.xMm + box.widthMm,
        yMm: footerY,
        font: regular,
        sizePt: HEAD_PT,
        colour: MUTED,
        alignRight: true,
      });
    });
  }

  return pdf.save();
}

function measureRow(doc: BrigadeDoc, job: Job, columns: Column[], font: PDFFont): Row {
  const block = blockFor(doc, job);
  const who = assigneeNames(doc, job).join(", ");

  const values: Record<string, string> = {
    time: block ? formatClock(block.startMin) : "--:--",
    label: job.label,
    location: block?.location ?? "",
    who: who || "nobody yet",
    during: block ? `${block.label}${block.moment ? " (moment)" : ""}` : "block deleted",
    notes: job.notes,
  };

  const cells = columns.map((column) => {
    const value = values[column.key] ?? "";
    // The clock is the spine of the sheet and never wraps.
    return column.key === "time"
      ? { lines: [truncate(value, font, BODY_PT, column.widthMm)] }
      : { lines: wrap(value, font, BODY_PT, column.widthMm) };
  });

  const lines = Math.max(...cells.map((cell) => cell.lines.length));
  return {
    cells,
    trouble: block === null,
    heightMm: ptToMm(lines * BODY_PT * LEADING) + 2.6,
  };
}

/** Page one carries the title block, so it holds fewer rows. */
function paginate(rows: Row[], firstMm: number, laterMm: number): number[][] {
  if (rows.length === 0) return [[]];

  let used = 0;
  let current: number[] = [];
  const pages: number[][] = [];

  rows.forEach((row, index) => {
    const available = pages.length === 0 ? firstMm : laterMm;
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

interface DrawContext {
  y: number;
  columns: Column[];
  offsets: number[];
  regular: PDFFont;
  bold: PDFFont;
  boxLeft: number;
  boxRight: number;
}

function drawRow(sheet: Sheet, row: Row, context: DrawContext): number {
  const lineHeightMm = ptToMm(BODY_PT * LEADING);

  context.columns.forEach((column, index) => {
    const cell = row.cells[index];
    if (!cell) return;
    cell.lines.forEach((line, lineIndex) => {
      if (line === "") return;
      sheet.text(line, {
        xMm: context.offsets[index] as number,
        yMm: context.y + lineHeightMm * (lineIndex + 1) - 0.8,
        font: column.key === "label" ? context.bold : context.regular,
        sizePt: BODY_PT,
        colour:
          column.key === "location" || column.key === "during" || column.key === "notes"
            ? MUTED
            : row.trouble && column.key === "time"
              ? DANGER
              : { r: 0, g: 0, b: 0 },
      });
    });
  });

  if (row.trouble) {
    // A mark in the margin, so work that has lost its place is visible with
    // the sheet at arm's length.
    sheet.rect(context.boxLeft - 3.5, context.y + 1.4, 1.4, lineHeightMm * 0.8, {
      colour: DANGER,
    });
  }

  const bottom = context.y + row.heightMm;
  sheet.line(context.boxLeft, bottom - 1, context.boxRight, bottom - 1, {
    widthPt: 0.5,
    colour: RULE,
  });
  return bottom;
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
