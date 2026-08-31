import type { PDFFont } from "pdf-lib";
import { mmToPt, ptToMm } from "./units";

/** Width of a string in millimetres, at a point size. */
export function measureMm(value: string, font: PDFFont, sizePt: number): number {
  return ptToMm(font.widthOfTextAtSize(value, sizePt));
}

/**
 * Breaks text to a width. A word longer than the whole column is broken
 * mid-word rather than allowed to run over the rule and into the next cell.
 */
export function wrap(value: string, font: PDFFont, sizePt: number, maxWidthMm: number): string[] {
  if (value === "") return [""];
  if (maxWidthMm <= 0) return [value];

  const lines: string[] = [];
  let line = "";

  const flush = () => {
    lines.push(line);
    line = "";
  };

  for (const word of value.split(/\s+/).filter(Boolean)) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measureMm(candidate, font, sizePt) <= maxWidthMm) {
      line = candidate;
      continue;
    }
    if (line !== "") flush();

    if (measureMm(word, font, sizePt) <= maxWidthMm) {
      line = word;
      continue;
    }
    // A single word wider than the column: break it by characters.
    let piece = "";
    for (const character of word) {
      if (measureMm(piece + character, font, sizePt) > maxWidthMm && piece !== "") {
        lines.push(piece);
        piece = character;
      } else {
        piece += character;
      }
    }
    line = piece;
  }

  if (line !== "" || lines.length === 0) lines.push(line);
  return lines;
}

/** One line, cut with an ellipsis where it will not fit. */
export function truncate(value: string, font: PDFFont, sizePt: number, maxWidthMm: number): string {
  if (measureMm(value, font, sizePt) <= maxWidthMm) return value;

  let cut = value;
  while (cut.length > 0 && measureMm(`${cut}…`, font, sizePt) > maxWidthMm) {
    cut = cut.slice(0, -1);
  }
  return cut === "" ? "" : `${cut}…`;
}

/** Height of a run of lines, leading included. */
export function blockHeightMm(lines: number, sizePt: number, leading = 1.35): number {
  return ptToMm(lines * sizePt * leading);
}

export { mmToPt };
