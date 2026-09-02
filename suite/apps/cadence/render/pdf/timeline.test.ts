import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import { nodeFontSource } from "./nodeFontSource";
import { textOf } from "./readPdf";
import { boxesFor, renderTimeline, type Body, type Lane, type Placed } from "./timeline";

const options = { fontSource: nodeFontSource, generatedOn: "Generated for the test" };

describe("renderTimeline", () => {
  it("puts the whole day on one page, lanes side by side", async () => {
    const { text, pages } = await textOf(await renderTimeline(sampleDoc(), options));

    expect(pages).toBe(1);
    expect(text).toContain("MAIN DAY");
    expect(text).toContain("SUPPLIERS");
    expect(text).toContain("TRANSPORT");
    expect(text).toContain("Ceremony");
    expect(text).toContain("Band, first set");
    expect(text).toContain("Charis & Jacob");
  });

  it("rules the page on the hour, from the first block to the last", async () => {
    const { text } = await textOf(await renderTimeline(sampleDoc(), options));
    // Florist install is anchored at 07:00, so the ruler starts there.
    expect(text).toContain("07:00");
    expect(text).toContain("13:00");
    // Past midnight the clock keeps counting: the last coach leaves at 00:30.
    expect(text).toContain("01:00");
  });

  it("names every block, however short it is against the page", async () => {
    const doc = sampleDoc();
    const { text } = await textOf(await renderTimeline(doc, options));
    // Confetti and the call to dinner are ten and fifteen minutes on an
    // eighteen hour page. A timeline that silently drops them is not one.
    const missing = doc.blocks
      .filter((block) => block.outputs.includes("run-sheet"))
      .filter((block) => !text.includes(block.label))
      .map((block) => block.label);
    expect(missing).toEqual([]);
  });

  it("draws a moment as a mark on the clock, not a box", async () => {
    const { text } = await textOf(await renderTimeline(sampleDoc(), options));
    // Zero minutes long: it prints its instant and its name, and no "until".
    expect(text).toContain("13:15 Rings to the best man");
    expect(text).not.toContain("Rings to the best man until");
  });

  it("spills onto a second page past four lanes", async () => {
    const doc = sampleDoc();
    const extra = ["Photography", "Registry", "Bar"];
    const spread = {
      ...doc,
      lanes: [...doc.lanes, ...extra],
      blocks: doc.blocks.map((block, index) =>
        index < extra.length
          ? { ...block, lane: extra[index] as string, anchorMin: 600 + index * 60 }
          : block,
      ),
    };
    const { pages } = await textOf(await renderTimeline(spread, options));
    expect(pages).toBe(2);
  });

  it("draws overlapping blocks beside each other, not on top", async () => {
    const doc = sampleDoc();
    const clashing = {
      ...doc,
      lanes: ["Main day"],
      blocks: [
        { ...(doc.blocks[0] as (typeof doc.blocks)[number]), lane: "Main day", anchorMin: 600 },
        {
          ...(doc.blocks[1] as (typeof doc.blocks)[number]),
          id: "blk-overlap",
          label: "Overlapping thing",
          lane: "Main day",
          anchorMin: 630,
          durationMin: 120,
        },
      ],
    };
    const { text } = await textOf(await renderTimeline(clashing, options));
    expect(text).toContain("Overlapping thing");
    expect(text).toContain("Bridal preparations");
  });

  it("packs a busy stretch of the evening without running off the page", async () => {
    // Fifty back-to-back one-minute blocks in one lane, late in the day —
    // exactly the shape that used to compound the readability floor's debt
    // past the bottom of the page with nothing to repay it against. Every
    // block still has to appear: a timeline that drops one to make room is
    // not one either.
    const doc = sampleDoc();
    // No anchor at all: each simply follows wherever the existing Main day
    // schedule's cursor already reached, so this chains on chronologically
    // rather than risking an anchor placed earlier than blocks already ahead
    // of it in the array.
    const busy = Array.from({ length: 18 }, (_, i) => ({
      id: `blk-busy-${i}`,
      label: `Busy moment ${i}`,
      durationMin: 2,
      anchorMin: null,
      gapMin: 0,
      bufferMin: 0,
      lane: "Main day",
      tags: [],
      location: "",
      notes: "",
      outputs: ["run-sheet" as const],
    }));

    const { text, pages } = await textOf(
      await renderTimeline({ ...doc, blocks: [...doc.blocks, ...busy] }, options),
    );

    expect(pages).toBe(1);
    for (const block of busy) expect(text).toContain(block.label);
  });

  it("renders an empty day without falling over", async () => {
    const { pages } = await textOf(await renderTimeline({ ...sampleDoc(), blocks: [] }, options));
    expect(pages).toBe(1);
  });
});

describe("boxesFor", () => {
  // A431mm page with headerMm 20, laneHeadMm 7, footerMm 8 and 12mm margins
  // leaves a 238mm-tall body running from 39mm to 277mm — the numbers a real
  // A4 run of renderTimeline would use. mmPerMin is set as it would be for an
  // eight-hour span on that body: 238 / 480.
  const body: Body = { bodyTop: 39, bodyHeight: 238, fromMin: 480, mmPerMin: 238 / 480 };
  const bottom = body.bodyTop + body.bodyHeight;
  const minBoxMm = 5.5;

  function placed(id: string, startMin: number, durationMin: number, column = 0): Placed {
    return {
      block: { id, label: id, durationMin, lane: "Main" } as Placed["block"],
      startMin,
      endMin: startMin + durationMin,
      column,
    };
  }

  it("never starts a box below the printable bottom of the page", () => {
    // Fifty one-minute blocks, back to back, starting three hours in — the
    // shape of a busy stretch of the evening with nothing between blocks to
    // repay the floor's debt against. Before the fix this ran the boxes' tops
    // straight through `bottom` and kept drawing anyway.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: Array.from({ length: 50 }, (_, i) => placed(`blk-${i}`, 660 + i, 1)),
    };

    const boxes = boxesFor(lane, body, minBoxMm);
    for (const box of boxes) {
      expect(box.topMm).toBeLessThanOrEqual(bottom);
    }
  });

  it("never draws a box past the printable bottom of the page either", () => {
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: Array.from({ length: 50 }, (_, i) => placed(`blk-${i}`, 660 + i, 1)),
    };

    const boxes = boxesFor(lane, body, minBoxMm);
    for (const box of boxes) {
      expect(box.topMm + box.heightMm).toBeLessThanOrEqual(bottom + 0.01);
    }
  });

  it("keeps every block, even once packing forces boxes below the readable floor", () => {
    // The same pathological lane. Nothing here may vanish — a timeline that
    // silently drops a block is not one, which is exactly what
    // "names every block" already asserts of the full render below.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: Array.from({ length: 50 }, (_, i) => placed(`blk-${i}`, 660 + i, 1)),
    };

    const boxes = boxesFor(lane, body, minBoxMm);
    expect(boxes).toHaveLength(50);
    for (const box of boxes) {
      expect(box.heightMm).toBeGreaterThan(0);
    }
  });

  it("does not touch a lane with enough page to hold it", () => {
    // The ordinary case: three blocks with real gaps, well inside the body.
    // Confirms the fix does not compress a page that never needed it.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: [placed("a", 480, 60), placed("b", 600, 60), placed("c", 720, 60)],
    };

    const boxes = boxesFor(lane, body, minBoxMm);
    expect(boxes[0]?.topMm).toBeCloseTo(body.bodyTop, 5);
    expect(boxes[0]?.heightMm).toBeCloseTo(60 * body.mmPerMin, 5);
  });

  it("scales two overlapping columns by the same factor, not independently", () => {
    // A lane packed enough in one column to trigger the debt should not warp
    // its shape relative to a second column sharing the same page — the
    // scale is one number for the whole lane, taken from whichever column's
    // debt is worst.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 2,
      placed: [
        ...Array.from({ length: 50 }, (_, i) => placed(`busy-${i}`, 660 + i, 1, 0)),
        placed("quiet", 480, 60, 1),
      ],
    };

    const boxes = boxesFor(lane, body, minBoxMm);
    const quiet = boxes.find((box) => box.entry.block.id === "quiet");
    // Scaled down along with the busy column, from the same bodyTop origin —
    // not left at its natural, unscaled position.
    expect(quiet?.topMm).toBeCloseTo(body.bodyTop, 5);
    expect(quiet?.heightMm).toBeLessThan(60 * body.mmPerMin);
  });
});
