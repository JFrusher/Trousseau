import { describe, expect, it } from "vitest";
import { columnOffsets, fitColumns, paginate, type Column } from "./table";

const columns: Column[] = [
  { key: "time", heading: "Time", widthMm: 20 },
  { key: "label", heading: "Block", widthMm: 60 },
  { key: "notes", heading: "Notes", widthMm: 40 },
];

describe("paginate", () => {
  it("puts two hundred rows on pages without splitting one", () => {
    const rows = Array.from({ length: 200 }, () => ({ heightMm: 7 }));
    const pages = paginate(rows, 250);

    const seen = pages.flat();
    expect(seen).toHaveLength(200);
    expect(new Set(seen).size).toBe(200);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);

    for (const page of pages) {
      const height = page.reduce((sum, index) => sum + (rows[index]?.heightMm ?? 0), 0);
      expect(height).toBeLessThanOrEqual(250);
    }
  });

  it("handles rows of different heights", () => {
    const rows = [{ heightMm: 10 }, { heightMm: 30 }, { heightMm: 10 }, { heightMm: 25 }];
    expect(paginate(rows, 40)).toEqual([[0, 1], [2, 3]]);
  });

  it("gives a row taller than the page its own page rather than dropping it", () => {
    const rows = [{ heightMm: 10 }, { heightMm: 400 }, { heightMm: 10 }];
    const pages = paginate(rows, 250);
    expect(pages.flat()).toEqual([0, 1, 2]);
    expect(pages).toHaveLength(3);
  });

  it("returns a single empty page for no rows", () => {
    expect(paginate([], 250)).toEqual([[]]);
  });
});

describe("columns", () => {
  it("offsets each column by the ones before it", () => {
    expect(columnOffsets(columns, 15, 4)).toEqual([15, 39, 103]);
  });

  it("scales widths to fill the space exactly", () => {
    const fitted = fitColumns(columns, 180, 4);
    const total = fitted.reduce((sum, column) => sum + column.widthMm, 0) + 8;
    expect(total).toBeCloseTo(180, 6);
  });

  it("leaves zero-width columns alone rather than dividing by nothing", () => {
    const zero: Column[] = [{ key: "a", heading: "A", widthMm: 0 }];
    expect(fitColumns(zero, 100, 4)).toEqual(zero);
  });
});
