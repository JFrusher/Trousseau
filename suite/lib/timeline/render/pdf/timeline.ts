import { PDFDocument, type PDFFont } from "pdf-lib";
import { tagLabel } from "../../core/model/tags";
import { isMoment, type Block, type TimelineDoc } from "../../core/model/types";
import { resolve } from "../../core/schedule/resolve";
import { formatClock, formatDuration } from "../../core/time/minutes";
import { embedFamily } from "./embedFonts";
import type { FontSource } from "./fontSource";
import { addSheet, hexColour, type Colour, type Sheet } from "./page";
import { measureMm, truncate } from "./text";
import { contentBox, mmToPt, PAGE_SIZES, ptToMm } from "./units";

export interface TimelineOptions {
  fontSource: FontSource;
  /** Shown in the footer beside the page numbers. */
  generatedOn?: string;
}

const MARGIN_MM = 12;
const GUTTER_MM = 13;
const LANES_PER_PAGE = 4;
const PAD_MM = 1.3;
const LEADING = 1.25;

interface Placed {
  block: Block;
  startMin: number;
  /** The block's own end, buffer excluded — the buffer prints as text, not as height. */
  endMin: number;
  /** Sub-column within the lane, for blocks that overlap each other. */
  column: number;
}

interface Lane {
  name: string;
  placed: Placed[];
  /** Zero-length blocks. They are drawn across the lane, not packed into it. */
  moments: Placed[];
  /** How many sub-columns the lane needs. One unless something overlaps. */
  columns: number;
}

/**
 * The wall piece: the whole day on one A4, time running down the page, one
 * column per lane. The run-sheet answers "what is next"; this answers "what is
 * happening at three o'clock" — the question you ask standing in a room rather
 * than holding a list.
 */
export async function renderTimeline(
  doc: TimelineDoc,
  options: TimelineOptions,
): Promise<Uint8Array> {
  // The timeline follows the master run-sheet's opt-ins. A piece nobody has to
  // tick is a piece that cannot be wrong on the morning it is needed.
  const style = doc.styles["run-sheet"];
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource(style.fontFamily));

  const size = PAGE_SIZES.A4;
  const box = contentBox(size, MARGIN_MM);
  const accent = hexColour(style.accentHex);
  const muted: Colour = { r: 0.44, g: 0.43, b: 0.41 };
  const rule: Colour = { r: 0.85, g: 0.84, b: 0.83 };

  const metaPt = 6.6 * style.typeScale;
  const labelPt = 8.4 * style.typeScale;
  const headPt = 8 * style.typeScale;
  // The floor is one line of "14:30 Ceremony": below that a box says nothing,
  // and a box that says nothing is worse than a taller one that lies slightly.
  const minBoxMm = ptToMm(labelPt * LEADING) + PAD_MM + 0.5;

  const lanes = laneLayout(doc);
  const span = spanOf(lanes);

  const headerMm = 20;
  const laneHeadMm = 7;
  const footerMm = 8;
  const bodyTop = box.yMm + headerMm + laneHeadMm;
  const bodyHeight = box.heightMm - headerMm - laneHeadMm - footerMm;
  // One page holds the whole day, however long it runs: the scale bends, never
  // the sheet count.
  const mmPerMin = bodyHeight / (span.toMin - span.fromMin);

  const pages: Lane[][] = [];
  for (let start = 0; start < lanes.length; start += LANES_PER_PAGE) {
    pages.push(lanes.slice(start, start + LANES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  pages.forEach((pageLanes, pageIndex) => {
    const sheet = addSheet(pdf, size);

    sheet.text(doc.day.coupleNames || "The day", {
      xMm: box.xMm,
      yMm: box.yMm + 6,
      font: bold,
      sizePt: 15 * style.typeScale,
    });
    const meta = [doc.day.venueName, formatDate(doc.day.date), "Timeline"]
      .filter(Boolean)
      .join("  ·  ");
    sheet.text(meta, {
      xMm: box.xMm,
      yMm: box.yMm + 11.5,
      font: regular,
      sizePt: headPt,
      colour: muted,
    });
    sheet.line(box.xMm, box.yMm + headerMm - 4, box.xMm + box.widthMm, box.yMm + headerMm - 4, {
      widthPt: Math.max(0.4, style.ruleWeightPt * 2),
      colour: accent,
    });

    const laneLeft = box.xMm + GUTTER_MM;
    const laneWidth = (box.widthMm - GUTTER_MM) / Math.max(1, pageLanes.length);

    pageLanes.forEach((lane, index) => {
      const x = laneLeft + laneWidth * index;
      sheet.text(truncate(lane.name.toUpperCase(), bold, headPt, laneWidth - 2), {
        xMm: x,
        yMm: bodyTop - 2.4,
        font: bold,
        sizePt: headPt,
        colour: muted,
      });
      if (index > 0) {
        sheet.line(x - 1, bodyTop - 6, x - 1, bodyTop + bodyHeight, { widthPt: 0.4, colour: rule });
      }
    });

    drawHours(sheet, {
      span,
      mmPerMin,
      bodyTop,
      left: box.xMm,
      right: box.xMm + box.widthMm,
      gutterRight: laneLeft - 2,
      font: regular,
      sizePt: metaPt,
      muted,
      rule,
    });

    pageLanes.forEach((lane, laneIndex) => {
      const laneX = laneLeft + laneWidth * laneIndex;
      const columnWidth = laneWidth / lane.columns;
      // One hue, deepening lane by lane: the columns stay apart in colour and
      // in greyscale without inventing a second palette.
      const fill = 0.09 + laneIndex * 0.07;

      const geometry = { bodyTop, bodyHeight, fromMin: span.fromMin, mmPerMin };
      boxesFor(lane, geometry, minBoxMm).forEach(({ entry, topMm, heightMm }) => {
        const x = laneX + columnWidth * entry.column;
        const width = columnWidth - 1.2;

        sheet.rect(x, topMm, width, heightMm, { colour: accent, opacity: fill });
        sheet.rect(x, topMm, 0.9, heightMm, { colour: accent });
        drawBoxText(sheet, entry, {
          doc,
          x: x + 0.9 + PAD_MM,
          top: topMm,
          height: heightMm,
          width: width - 0.9 - PAD_MM * 2,
          regular,
          bold,
          metaPt,
          labelPt,
          muted,
        });
      });

      // Moments last, so they read on top of whatever is running underneath.
      lane.moments.forEach((entry) => {
        drawMoment(sheet, entry, {
          x: laneX,
          width: laneWidth - 1.2,
          y: bodyTop + (entry.startMin - span.fromMin) * mmPerMin,
          bodyBottom: bodyTop + bodyHeight,
          bold,
          sizePt: metaPt,
          accent,
        });
      });
    });

    const footerY = size.heightMm - MARGIN_MM + 4;
    sheet.text(options.generatedOn ?? "", {
      xMm: box.xMm,
      yMm: footerY,
      font: regular,
      sizePt: metaPt,
      colour: muted,
    });
    sheet.text(`Page ${pageIndex + 1} of ${pages.length}`, {
      xMm: box.xMm + box.widthMm,
      yMm: footerY,
      font: regular,
      sizePt: metaPt,
      colour: muted,
      alignRight: true,
    });
  });

  return pdf.save();
}

/** Lanes that carry a block, each packed into as few sub-columns as its overlaps allow. */
function laneLayout(doc: TimelineDoc): Lane[] {
  const positions = new Map(resolve(doc).map((entry) => [entry.id, entry]));
  const chosen = doc.blocks.filter((block) => block.outputs.includes("run-sheet"));

  return doc.lanes
    .map((name) => {
      const all = chosen
        .filter((block) => block.lane === name)
        .map((block) => {
          const at = positions.get(block.id);
          const startMin = at?.startMin ?? 0;
          return {
            block,
            startMin,
            // The squeezed length, as everywhere else: the box must agree with
            // the clock printed inside it.
            endMin: at?.contentEndMin ?? startMin + block.durationMin,
          };
        })
        .sort((a, b) => a.startMin - b.startMin);

      // A moment is drawn on the lane rather than in it, so it never widens the
      // lane by claiming a sub-column of its own.
      const moments = all
        .filter(({ block }) => isMoment(block))
        .map((entry) => ({ ...entry, column: 0 }));
      const entries = all.filter(({ block }) => !isMoment(block));

      // Greedy interval packing: the first sub-column already free takes it.
      const freeAt: number[] = [];
      const placed: Placed[] = entries.map((entry) => {
        let column = freeAt.findIndex((end) => end <= entry.startMin);
        if (column === -1) column = freeAt.length;
        freeAt[column] = entry.endMin;
        return { ...entry, column };
      });

      return { name, placed, moments, columns: Math.max(1, freeAt.length) };
    })
    .filter((lane) => lane.placed.length + lane.moments.length > 0);
}

/** The hours the page covers, rounded out so the ruler starts and ends on the hour. */
function spanOf(lanes: Lane[]): { fromMin: number; toMin: number } {
  const all = lanes.flatMap((lane) => [...lane.placed, ...lane.moments]);
  if (all.length === 0) return { fromMin: 480, toMin: 1440 };

  const first = Math.min(...all.map((entry) => entry.startMin));
  const last = Math.max(...all.map((entry) => entry.endMin));
  const fromMin = Math.floor(first / 60) * 60;
  // Round out past the last block, never onto it: a day ending on the hour
  // would otherwise leave its final box with no depth to print itself in.
  return { fromMin, toMin: Math.max(fromMin + 60, Math.ceil((last + 1) / 60) * 60) };
}

interface Body {
  bodyTop: number;
  bodyHeight: number;
  fromMin: number;
  mmPerMin: number;
}

interface Box {
  entry: Placed;
  topMm: number;
  heightMm: number;
}

/**
 * Every box in a lane, in millimetres down the page. A block shorter than one
 * readable line is drawn at that minimum and the blocks under it shuffle down
 * to make the room — a debt the lane repays at the first real gap, so the drift
 * stays inside the run of back-to-back blocks that caused it rather than
 * walking the whole evening off its own hour line.
 */
function boxesFor(lane: Lane, body: Body, minBoxMm: number): Box[] {
  const bottom = body.bodyTop + body.bodyHeight;
  const cursor = new Map<number, number>();

  return lane.placed.map((entry) => {
    const trueTop = body.bodyTop + (entry.startMin - body.fromMin) * body.mmPerMin;
    const topMm = Math.max(trueTop, cursor.get(entry.column) ?? trueTop);
    const natural = (entry.endMin - entry.startMin) * body.mmPerMin;
    const heightMm = Math.max(0.8, Math.min(Math.max(natural, minBoxMm), bottom - topMm));
    cursor.set(entry.column, topMm + heightMm + 0.7);
    return { entry, topMm, heightMm };
  });
}

interface HourContext {
  span: { fromMin: number; toMin: number };
  bodyTop: number;
  mmPerMin: number;
  left: number;
  right: number;
  gutterRight: number;
  font: PDFFont;
  sizePt: number;
  muted: Colour;
  rule: Colour;
}

function drawHours(sheet: Sheet, context: HourContext): void {
  for (let minute = context.span.fromMin; minute <= context.span.toMin; minute += 60) {
    const y = context.bodyTop + (minute - context.span.fromMin) * context.mmPerMin;
    sheet.line(context.left, y, context.right, y, { widthPt: 0.3, colour: context.rule });
    sheet.text(formatClock(minute), {
      xMm: context.gutterRight,
      yMm: y + ptToMm(context.sizePt) * 0.8,
      font: context.font,
      sizePt: context.sizePt,
      colour: context.muted,
      alignRight: true,
    });
  }
}

interface MomentContext {
  x: number;
  width: number;
  y: number;
  bodyBottom: number;
  bold: PDFFont;
  sizePt: number;
  accent: Colour;
}

/**
 * A moment has no height to fill, so it is a rule across the lane with its
 * name sitting on it — the one thing on the page that is a line rather than a
 * box, because that is what it is on the day.
 */
function drawMoment(sheet: Sheet, entry: Placed, context: MomentContext): void {
  const lineHeight = ptToMm(context.sizePt * LEADING);
  const top = Math.min(context.y, context.bodyBottom - lineHeight);
  const text = `${formatClock(entry.startMin)}  ${entry.block.label}`;

  // Knocked back out of whatever it crosses, or the name reads as two names.
  sheet.rect(context.x, top, context.width, lineHeight, {
    colour: { r: 1, g: 1, b: 1 },
    opacity: 0.82,
  });
  sheet.line(context.x, context.y, context.x + context.width, context.y, {
    widthPt: 0.7,
    colour: context.accent,
  });
  sheet.rect(context.x, context.y - 0.7, 1.4, 1.4, { colour: context.accent });
  sheet.text(truncate(text, context.bold, context.sizePt, context.width - 3.4), {
    xMm: context.x + 2.4,
    yMm: top + lineHeight - ptToMm(context.sizePt) * 0.25,
    font: context.bold,
    sizePt: context.sizePt,
    colour: context.accent,
  });
}

interface BoxContext {
  doc: TimelineDoc;
  x: number;
  top: number;
  height: number;
  width: number;
  regular: PDFFont;
  bold: PDFFont;
  metaPt: number;
  labelPt: number;
  muted: Colour;
}

/**
 * As much of the block as the box has room for, in the order it is wanted.
 * The start time and the label share the first line, because a short block's
 * box holds exactly one line and neither of those two is the one to drop.
 * After that: the end and length, where, who, the notes. Nothing overflows its
 * box — a line that will not fit is simply not printed.
 */
function drawBoxText(sheet: Sheet, entry: Placed, context: BoxContext): void {
  const { block } = entry;
  const who = block.tags.map((tag) => tagLabel(context.doc, tag)).join(", ");
  const notes = [block.notes, block.bufferMin > 0 ? `+${block.bufferMin}m spare` : ""]
    .filter(Boolean)
    .join(" · ");

  const bottom = context.top + context.height - 0.4;
  // A ten minute block against an eighteen hour page is a sliver whatever the
  // scale. Rather than push the rest of the lane off its true time to make
  // room, the sliver's own line shrinks to fit — down to 5pt, below which
  // there is no point putting ink on the paper at all.
  const headPt = Math.min(
    context.labelPt,
    mmToPt(context.height - PAD_MM * 0.5 - 0.4) / LEADING,
  );
  if (headPt < 5) return;

  const tight = headPt < context.labelPt;
  const headHeight = ptToMm(headPt * LEADING);
  let y = context.top + (tight ? PAD_MM * 0.25 : PAD_MM);

  const start = `${formatClock(entry.startMin)} `;
  const startPt = Math.min(context.metaPt, headPt);
  const startWidth = measureMm(start, context.regular, startPt);
  const baseline = y + headHeight - ptToMm(headPt) * 0.25;
  sheet.text(start, {
    xMm: context.x,
    yMm: baseline,
    font: context.regular,
    sizePt: startPt,
    colour: context.muted,
  });
  sheet.text(truncate(block.label, context.bold, headPt, context.width - startWidth), {
    xMm: context.x + startWidth,
    yMm: baseline,
    font: context.bold,
    sizePt: headPt,
  });
  y += headHeight;

  const rest = [
    `until ${formatClock(entry.endMin)} · ${formatDuration(entry.endMin - entry.startMin)}`,
    block.location,
    who,
    notes,
  ].filter(Boolean);

  const lineHeight = ptToMm(context.metaPt * LEADING);
  for (const line of rest) {
    if (y + lineHeight > bottom) return;
    sheet.text(truncate(line, context.regular, context.metaPt, context.width), {
      xMm: context.x,
      yMm: y + lineHeight - ptToMm(context.metaPt) * 0.25,
      font: context.regular,
      sizePt: context.metaPt,
      colour: context.muted,
    });
    y += lineHeight;
  }
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
