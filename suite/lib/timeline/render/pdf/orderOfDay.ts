import { PDFDocument } from "pdf-lib";
import { resolve } from "../../core/schedule/resolve";
import type { TimelineDoc } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import { embedFamily } from "./embedFonts";
import type { FontSource } from "./fontSource";
import { addSheet, hexColour } from "./page";
import { measureMm } from "./text";
import { contentBox, PAGE_SIZES, ptToMm } from "./units";

export interface OrderOfDayOptions {
  fontSource: FontSource;
}

const MARGIN_MM = 14;

/**
 * The guest-facing piece. Times and titles only — no notes, no supplier tags,
 * nothing operational. A guest wants to know when to sit down, not when the
 * band load in.
 */
export async function renderOrderOfDay(
  doc: TimelineDoc,
  options: OrderOfDayOptions,
): Promise<Uint8Array> {
  const style = doc.styles["order-of-day"];
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource(style.fontFamily));

  const size = PAGE_SIZES.A5;
  const box = contentBox(size, MARGIN_MM);
  const accent = hexColour(style.accentHex);

  const titlePt = 20 * style.typeScale;
  const bodyPt = 11 * style.typeScale;
  const rowMm = ptToMm(bodyPt * 2.5);

  const positions = new Map(resolve(doc).map((entry) => [entry.id, entry]));
  const entries = doc.blocks
    .filter((block) => block.outputs.includes("order-of-day"))
    .map((block) => ({
      label: block.label,
      startMin: positions.get(block.id)?.startMin ?? 0,
    }))
    .sort((a, b) => a.startMin - b.startMin);

  const centre = box.xMm + box.widthMm / 2;
  const perPage = Math.max(1, Math.floor((box.heightMm - 42) / rowMm));

  for (let start = 0; start < Math.max(entries.length, 1); start += perPage) {
    const sheet = addSheet(pdf, size);
    let y = box.yMm + 14;

    if (start === 0) {
      const title = doc.day.coupleNames || "Order of the day";
      sheet.text(title, {
        xMm: centre + measureMm(title, bold, titlePt) / 2,
        yMm: y,
        font: bold,
        sizePt: titlePt,
        alignRight: true,
      });
      y += 8;

      const subtitle = "Order of the day";
      sheet.text(subtitle, {
        xMm: centre + measureMm(subtitle, regular, bodyPt * 0.85) / 2,
        yMm: y,
        font: regular,
        sizePt: bodyPt * 0.85,
        alignRight: true,
        colour: accent,
      });
      y += 6;

      sheet.line(centre - 12, y, centre + 12, y, {
        widthPt: Math.max(0.4, style.ruleWeightPt),
        colour: accent,
      });
      y += 12;
    }

    for (const entry of entries.slice(start, start + perPage)) {
      const time = formatClock(entry.startMin);
      sheet.text(time, {
        xMm: centre - 4,
        yMm: y,
        font: regular,
        sizePt: bodyPt,
        alignRight: true,
        colour: accent,
      });
      sheet.text(entry.label, { xMm: centre + 4, yMm: y, font: regular, sizePt: bodyPt });
      y += rowMm;
    }
  }

  return pdf.save();
}
