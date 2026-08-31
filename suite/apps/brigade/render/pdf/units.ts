export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

export interface PageSize {
  widthMm: number;
  heightMm: number;
}

export const PAGE_SIZES: Record<"A4" | "A5", PageSize> = {
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
};

export interface Box {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** The printable area, inset from the page edge. */
export function contentBox(size: PageSize, marginMm: number): Box {
  return {
    xMm: marginMm,
    yMm: marginMm,
    widthMm: size.widthMm - marginMm * 2,
    heightMm: size.heightMm - marginMm * 2,
  };
}
