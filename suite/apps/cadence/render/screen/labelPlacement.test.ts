import { describe, expect, it } from "vitest";
import { blockDetail, placeLabels, type LabelBox } from "./labelPlacement";

describe("blockDetail", () => {
  it("gives a tall box everything and a sliver nothing", () => {
    expect(blockDetail(60)).toBe("full");
    expect(blockDetail(46)).toBe("full");
    expect(blockDetail(45)).toBe("compact");
    expect(blockDetail(28)).toBe("compact");
    expect(blockDetail(27)).toBe("name");
    expect(blockDetail(16)).toBe("name");
    expect(blockDetail(15)).toBe("outside");
    expect(blockDetail(0)).toBe("outside");
  });
});

describe("placeLabels", () => {
  const label = 15;

  it("takes the free space after the block", () => {
    const boxes: LabelBox[] = [
      { id: "a", topPx: 0, heightPx: 10 },
      { id: "b", topPx: 100, heightPx: 40 },
    ];
    expect(placeLabels(boxes, new Set(["a"]), label, 400).get("a")).toBe(10);
  });

  it("falls back to the space before when the space after is taken", () => {
    const boxes: LabelBox[] = [
      { id: "a", topPx: 40, heightPx: 10 },
      { id: "b", topPx: 50, heightPx: 60 },
    ];
    // Nothing free below: b starts the moment a ends. Above a is clear.
    expect(placeLabels(boxes, new Set(["a"]), label, 400).get("a")).toBe(25);
  });

  it("keeps two labels in one gap from overlapping", () => {
    const boxes: LabelBox[] = [
      { id: "a", topPx: 0, heightPx: 6 },
      { id: "b", topPx: 8, heightPx: 6 },
    ];
    const placed = placeLabels(boxes, new Set(["a", "b"]), label, 400);
    const a = placed.get("a") as number;
    const b = placed.get("b") as number;
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(label);
  });

  it("never lays a label over a box", () => {
    const boxes: LabelBox[] = [
      { id: "a", topPx: 0, heightPx: 6 },
      { id: "b", topPx: 10, heightPx: 80 },
      { id: "c", topPx: 95, heightPx: 6 },
    ];
    const placed = placeLabels(boxes, new Set(["a", "c"]), label, 400);
    for (const [id, top] of placed) {
      for (const box of boxes) {
        if (box.id === id) continue;
        const clear = top + label <= box.topPx || top >= box.topPx + box.heightPx;
        expect(clear).toBe(true);
      }
    }
  });

  it("keeps a label inside the column", () => {
    const boxes: LabelBox[] = [{ id: "a", topPx: 390, heightPx: 6 }];
    const top = placeLabels(boxes, new Set(["a"]), label, 400).get("a") as number;
    expect(top + label).toBeLessThanOrEqual(400);
  });

  it("slides up when sliding down runs out of column", () => {
    const boxes: LabelBox[] = [
      { id: "X", topPx: 0, heightPx: 10 },
      { id: "Z", topPx: 10, heightPx: 75 },
      { id: "Y", topPx: 88, heightPx: 12 },
    ];
    const placed = placeLabels(boxes, new Set(["X"]), label, 100);
    const xTop = placed.get("X") as number;
    // Verify X's label does not overlap Y (Y is at 88–100)
    const clear = xTop + label <= 88 || xTop >= 100;
    expect(clear).toBe(true);
  });

  it("places label on its own block when the column has no free space", () => {
    const boxes: LabelBox[] = [
      { id: "a", topPx: 0, heightPx: 20 },
      { id: "b", topPx: 20, heightPx: 20 },
      { id: "c", topPx: 40, heightPx: 20 },
      { id: "d", topPx: 60, heightPx: 20 },
      { id: "e", topPx: 80, heightPx: 20 },
    ];
    const placed = placeLabels(boxes, new Set(["c"]), label, 100);
    const cTop = placed.get("c") as number;
    // Label must stay within column bounds
    expect(cTop).toBeGreaterThanOrEqual(0);
    expect(cTop + label).toBeLessThanOrEqual(100);
  });
});
