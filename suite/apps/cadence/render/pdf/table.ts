export interface MeasuredRow {
  heightMm: number;
}

/**
 * Splits measured rows across pages. A row never straddles a page break — a
 * run-sheet line cut in half at the fold is exactly the failure that gets
 * someone standing in the wrong place at the wrong time.
 */
export function paginate(rows: MeasuredRow[], availableHeightMm: number): number[][] {
  if (rows.length === 0) return [[]];

  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;

  rows.forEach((row, index) => {
    // A row taller than a whole page still has to go somewhere: it gets a page
    // of its own and overflows it, rather than vanishing.
    if (current.length > 0 && used + row.heightMm > availableHeightMm) {
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

export interface Column {
  key: string;
  heading: string;
  widthMm: number;
  alignRight?: boolean;
}

/** Column x positions from their widths and the left edge. */
export function columnOffsets(columns: Column[], leftMm: number, gapMm: number): number[] {
  const offsets: number[] = [];
  let x = leftMm;
  for (const column of columns) {
    offsets.push(x);
    x += column.widthMm + gapMm;
  }
  return offsets;
}

/** Scales column widths so they exactly fill the available width. */
export function fitColumns(columns: Column[], availableMm: number, gapMm: number): Column[] {
  const gaps = gapMm * Math.max(0, columns.length - 1);
  const total = columns.reduce((sum, column) => sum + column.widthMm, 0);
  if (total <= 0) return columns;
  const scale = (availableMm - gaps) / total;
  return columns.map((column) => ({ ...column, widthMm: column.widthMm * scale }));
}
