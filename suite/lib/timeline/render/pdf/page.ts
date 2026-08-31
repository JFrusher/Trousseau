import { rgb, type PDFFont, type PDFPage, type PDFDocument } from "pdf-lib";
import { mmToPt, PAGE_SIZES, type PageSize } from "./units";

/**
 * A page with the origin at the top left and millimetres for units, which is
 * how a printed sheet is measured. pdf-lib works from the bottom left in
 * points; this is the only place that difference exists.
 */
export interface Sheet {
  page: PDFPage;
  size: PageSize;
  text(value: string, options: TextOptions): void;
  line(fromXMm: number, fromYMm: number, toXMm: number, toYMm: number, options?: LineOptions): void;
  rect(xMm: number, yMm: number, widthMm: number, heightMm: number, options?: RectOptions): void;
}

export interface TextOptions {
  xMm: number;
  /** Distance from the top of the page to the text's baseline. */
  yMm: number;
  font: PDFFont;
  sizePt: number;
  colour?: Colour;
  /** Right-aligns the string so it ends at `xMm`. */
  alignRight?: boolean;
}

export interface LineOptions {
  widthPt?: number;
  colour?: Colour;
  dashed?: boolean;
}

export interface RectOptions {
  colour?: Colour;
  opacity?: number;
}

export type Colour = { r: number; g: number; b: number };

export const BLACK: Colour = { r: 0, g: 0, b: 0 };

/** `#37548a` to a colour. Bad input falls back to black rather than throwing. */
export function hexColour(hex: string): Colour {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return BLACK;
  const value = parseInt(match[1] as string, 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

export function addSheet(pdf: PDFDocument, size: PageSize): Sheet {
  const page = pdf.addPage([mmToPt(size.widthMm), mmToPt(size.heightMm)]);
  const fromTop = (yMm: number) => mmToPt(size.heightMm - yMm);

  return {
    page,
    size,
    text(value, options) {
      const width = options.font.widthOfTextAtSize(value, options.sizePt);
      const colour = options.colour ?? BLACK;
      page.drawText(value, {
        x: mmToPt(options.xMm) - (options.alignRight ? width : 0),
        y: fromTop(options.yMm),
        size: options.sizePt,
        font: options.font,
        color: rgb(colour.r, colour.g, colour.b),
      });
    },
    line(fromXMm, fromYMm, toXMm, toYMm, options = {}) {
      const colour = options.colour ?? BLACK;
      page.drawLine({
        start: { x: mmToPt(fromXMm), y: fromTop(fromYMm) },
        end: { x: mmToPt(toXMm), y: fromTop(toYMm) },
        thickness: options.widthPt ?? 0.5,
        color: rgb(colour.r, colour.g, colour.b),
        ...(options.dashed ? { dashArray: [2, 2] } : {}),
      });
    },
    rect(xMm, yMm, widthMm, heightMm, options = {}) {
      const colour = options.colour ?? BLACK;
      page.drawRectangle({
        x: mmToPt(xMm),
        y: fromTop(yMm + heightMm),
        width: mmToPt(widthMm),
        height: mmToPt(heightMm),
        color: rgb(colour.r, colour.g, colour.b),
        opacity: options.opacity ?? 1,
      });
    },
  };
}

export { PAGE_SIZES };
