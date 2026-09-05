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
const MAX_LANES_PER_PAGE = 4;
const PAD_MM = 1.3;
const LEADING = 1.25;
/** Below this, drawBoxText already refuses to print — see minHeightForPt. */
const MIN_LABEL_PT = 5;

/**
 * The shortest a box can be and still hold one line of type at `pt`, in the
 * same units `boxesFor` and `drawBoxText` both work in.
 *
 * One formula rather than two. Before this, `boxesFor` inflated every short
 * block up to a fixed floor sized for full-size type — a ten minute block on
 * an eighteen hour page drew as tall as a twenty-five minute one, its box
 * telling a different length than the clock beside it says. `drawBoxText`
 * separately shrinks its own type down to `MIN_LABEL_PT` to fit whatever
 * height it is actually given. The two are meant to agree on where "too
 * short for any type at all" begins; written twice, they eventually would not.
 */
function minHeightForPt(pt: number): number {
  return ptToMm(pt * LEADING) + PAD_MM * 0.5 + 0.4;
}

export interface Placed {
  block: Block;
  startMin: number;
  /** The block's own end, buffer excluded — the buffer prints as text, not as height. */
  endMin: number;
  /** Sub-column within the lane, for blocks that overlap each other. */
  column: number;
}

export interface Lane {
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
  // A box's height is its duration on the clock and nothing else. Below this,
  // there is no room for a line of type, and the label rides beside the box
  // instead — see the `slivers` pass below.
  const readableFloorMm = minHeightForPt(MIN_LABEL_PT);

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

  const pages: Lane[][] = paginateLanes(lanes);

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
      const slivers: Placed[] = [];

      boxesFor(lane, geometry).forEach(({ entry, topMm, heightMm }) => {
        const x = laneX + columnWidth * entry.column;
        const width = columnWidth - 1.2;

        // The box is always the true duration, however small — it must never
        // claim more time than the block actually has. One too short to hold
        // a line of type prints no text of its own here; it gets a label
        // riding beside it instead, in the pass below, the same way a
        // zero-length moment already does.
        sheet.rect(x, topMm, width, heightMm, { colour: accent, opacity: fill });
        sheet.rect(x, topMm, 0.9, heightMm, { colour: accent });

        // A start and an end rule, drawn at the box's true edges rather than
        // any gap between boxes — a gap once compounded block after block on
        // a back-to-back day and drove the whole lane off its true time (see
        // boxesFor's history). Two back-to-back blocks share the same line.
        sheet.line(x, topMm, x + width, topMm, { widthPt: 0.7, colour: accent });
        sheet.line(x, topMm + heightMm, x + width, topMm + heightMm, { widthPt: 0.7, colour: accent });

        if (heightMm < readableFloorMm) {
          slivers.push(entry);
          return;
        }

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

      // Moments and slivers last, so their labels read on top of whatever is
      // running underneath rather than the box being drawn over them.
      [...lane.moments, ...slivers].forEach((entry) => {
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

/**
 * Lanes grouped onto pages, at most `MAX_LANES_PER_PAGE` to a page, split as
 * evenly as the count allows — six lanes make two pages of three, not four
 * and two, so no page is left narrower than it has to be.
 */
export function paginateLanes(lanes: Lane[]): Lane[][] {
  if (lanes.length === 0) return [[]];

  const pageCount = Math.ceil(lanes.length / MAX_LANES_PER_PAGE);
  const base = Math.floor(lanes.length / pageCount);
  const remainder = lanes.length % pageCount;

  const pages: Lane[][] = [];
  let index = 0;
  for (let p = 0; p < pageCount; p++) {
    const size = base + (p < remainder ? 1 : 0);
    pages.push(lanes.slice(index, index + size));
    index += size;
  }
  return pages;
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

export interface Body {
  bodyTop: number;
  bodyHeight: number;
  fromMin: number;
  mmPerMin: number;
}

export interface Box {
  entry: Placed;
  topMm: number;
  heightMm: number;
}

/**
 * Every box in a lane, in millimetres down the page, at its true duration.
 *
 * A box's height must be honest — the one thing a reader trusts it for
 * without reading the type inside it is how long the coloured bar runs, and a
 * box drawn taller than its block lasts is a box that lies about the block it
 * stands for. That used to happen on purpose: a block shorter than one
 * readable line was inflated up to a fixed floor so its label always had
 * somewhere to sit, on the reasoning that a box saying nothing was worse than
 * a taller one that lied slightly. It is not — a ten minute block drawn as
 * long as a twenty-five minute one is wrong every time it happens, not only
 * when a reader checks the clock beside it. What replaces it: the box always
 * tells the truth about its own length, and a block too short to hold a line
 * of type gets its label drawn beside it instead, the same way a zero-length
 * moment already is — see the `slivers` pass in `renderTimeline`.
 *
 * The one thing still worth guarding here is the page, not the box: a column
 * holding enough blocks — a long run of them, or simply a great many — can
 * still carry its true total past the bottom on its own, with no single
 * block anywhere near the reader's fault for it. If a column's natural total
 * would carry it past `bottom`, the whole column scales back — positions and
 * heights together — until its last box lands exactly on the page. Nothing
 * is dropped and nothing prints past the bottom.
 *
 * There used to be a fixed 0.7mm gutter added after every box on top of its
 * true duration, to leave visual breathing room between one box and the
 * next. Column assignment already guarantees no two blocks in the same
 * column overlap in time, so that gutter was never needed to prevent boxes
 * touching — but stacked one atop another for every box in the column, it
 * silently pushed each later box further from its true time than the one
 * before, with nothing to ever pay the debt back on a lane that never has a
 * real gap between blocks (a normal back-to-back day-of schedule, ceremony
 * to last dance). A box's position is as much a promise as its height: it
 * belongs exactly on its own true time, gap or no gap.
 */
export function boxesFor(lane: Lane, body: Body): Box[] {
  const bottom = body.bodyTop + body.bodyHeight;

  const natural = lane.placed.map((entry) => {
    const topMm = body.bodyTop + (entry.startMin - body.fromMin) * body.mmPerMin;
    const heightMm = Math.max(0, (entry.endMin - entry.startMin) * body.mmPerMin);
    return { entry, topMm, heightMm };
  });

  // The deepest any column's true extent reaches. Columns are independent —
  // one lane can hold several sub-columns of overlapping blocks — so this has
  // to be the worst of them, not any single column's own total.
  const deepestByColumn = new Map<number, number>();
  for (const { entry, topMm, heightMm } of natural) {
    const prev = deepestByColumn.get(entry.column) ?? topMm;
    deepestByColumn.set(entry.column, Math.max(prev, topMm + heightMm));
  }
  const deepest = Math.max(bottom, ...deepestByColumn.values());
  const scale = deepest > bottom ? (bottom - body.bodyTop) / (deepest - body.bodyTop) : 1;

  return natural.map(({ entry, topMm, heightMm }) => ({
    entry,
    topMm: body.bodyTop + (topMm - body.bodyTop) * scale,
    heightMm: heightMm * scale,
  }));
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
  if (headPt < MIN_LABEL_PT) return;

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
