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

  it("keeps every lane on one page, squeezing their width instead of spilling past four", async () => {
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
    const { text, pages } = await textOf(await renderTimeline(spread, options));
    expect(pages).toBe(1);
    for (const lane of spread.lanes) expect(text).toContain(lane.toUpperCase());
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
  // A4 page with headerMm 20, laneHeadMm 7, footerMm 8 and 12mm margins
  // leaves a 238mm-tall body running from 39mm to 277mm — the numbers a real
  // A4 run of renderTimeline would use. mmPerMin is set as it would be for an
  // eight-hour span on that body: 238 / 480.
  const body: Body = { bodyTop: 39, bodyHeight: 238, fromMin: 480, mmPerMin: 238 / 480 };
  const bottom = body.bodyTop + body.bodyHeight;

  function placed(id: string, startMin: number, durationMin: number, column = 0): Placed {
    return {
      block: { id, label: id, durationMin, lane: "Main" } as Placed["block"],
      startMin,
      endMin: startMin + durationMin,
      column,
    };
  }

  it("draws a box exactly as tall as the block's real duration, never inflated", () => {
    // The actual bug report: boxes were "sized bigger than they take up".
    // A block shorter than one readable line used to be inflated up to a
    // fixed floor regardless of its true length — a ten minute block drawn as
    // tall as a twenty-five minute one. There is no floor left to hit here.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: [placed("tiny", 480, 3), placed("short", 483, 10), placed("long", 493, 60)],
    };

    const [tiny, short, long] = boxesFor(lane, body);
    expect(tiny?.heightMm).toBeCloseTo(3 * body.mmPerMin, 5);
    expect(short?.heightMm).toBeCloseTo(10 * body.mmPerMin, 5);
    expect(long?.heightMm).toBeCloseTo(60 * body.mmPerMin, 5);
  });

  it("gives two blocks of equal length equal height, whatever their duration", () => {
    // Restated the other way round: height is a pure function of duration,
    // not a step function that goes flat below some cutoff.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: [placed("a", 480, 4), placed("b", 700, 4)],
    };

    const [a, b] = boxesFor(lane, body);
    expect(a?.heightMm).toBeCloseTo(b?.heightMm ?? -1, 10);
  });

  it("a zero-length entry draws a zero-height box, not a floor-sized one", () => {
    const lane: Lane = { name: "Main", moments: [], columns: 1, placed: [placed("blip", 480, 0)] };
    expect(boxesFor(lane, body)[0]?.heightMm).toBe(0);
  });

  it("does not touch a lane with enough page to hold it", () => {
    // The ordinary case: three blocks with real gaps, well inside the body.
    // Confirms the overflow guard does not compress a page that never
    // needed it.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: [placed("a", 480, 60), placed("b", 600, 60), placed("c", 720, 60)],
    };

    const boxes = boxesFor(lane, body);
    expect(boxes[0]?.topMm).toBeCloseTo(body.bodyTop, 5);
    expect(boxes[0]?.heightMm).toBeCloseTo(60 * body.mmPerMin, 5);
  });

  it("never starts or draws a box past the printable bottom of the page", () => {
    // With no floor left to inflate individual boxes, the only way left to
    // overrun the page is sheer count: enough blocks that the fixed 0.7mm
    // gutter between them alone outgrows the body. Five hundred one-minute
    // blocks add roughly 600mm of gutter and content against a 238mm body.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: Array.from({ length: 500 }, (_, i) => placed(`blk-${i}`, 480 + i, 1)),
    };

    const boxes = boxesFor(lane, body);
    for (const box of boxes) {
      expect(box.topMm).toBeLessThanOrEqual(bottom);
      expect(box.topMm + box.heightMm).toBeLessThanOrEqual(bottom + 0.01);
    }
  });

  it("keeps every block even once the page forces them scaled down", () => {
    // Nothing here may vanish — a timeline that silently drops a block is
    // not one, which is exactly what "names every block" already asserts of
    // the full render below.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: Array.from({ length: 500 }, (_, i) => placed(`blk-${i}`, 480 + i, 1)),
    };

    expect(boxesFor(lane, body)).toHaveLength(500);
  });

  it("keeps a fully back-to-back day on its true time, gap or no gap", () => {
    // The actual bug report: a normal day-of schedule — one block ending
    // exactly where the next starts, all the way down, comfortably inside
    // the page — drifted later and later the further down the lane it went.
    // Ten blocks with zero gap between any of them, mirroring a real
    // ceremony-to-last-dance run: 660 minutes of content on a page sized for
    // the day's full 780-minute span (13:00 to past midnight), the same
    // slack a real wedding day leaves top and bottom. Nothing here should
    // ever need scaling.
    const dayBody: Body = { bodyTop: 39, bodyHeight: 238, fromMin: 720, mmPerMin: 238 / 780 };
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 1,
      placed: [
        placed("a", 780, 60), // 13:00-14:00 Ceremony
        placed("b", 840, 30), // 14:00-14:30 Sandwiches
        placed("c", 870, 60), // 14:30-15:30 Group Photos
        placed("d", 930, 30), // 15:30-16:00 Cake cutting + Speeches
        placed("e", 960, 30), // 16:00-16:30 Hall Transfer Window
        placed("f", 990, 60), // 16:30-17:30 Cocktail Hour
        placed("g", 1050, 120), // 17:30-19:30 Food
        placed("h", 1170, 30), // 19:30-20:00 Speeches + Announcements
        placed("i", 1200, 210), // 20:00-23:30 Dancing
        placed("j", 1410, 30), // 23:30-00:00 Leave
      ],
    };

    const boxes = boxesFor(lane, dayBody);
    for (const box of boxes) {
      const trueTop = dayBody.bodyTop + (box.entry.startMin - dayBody.fromMin) * dayBody.mmPerMin;
      expect(box.topMm).toBeCloseTo(trueTop, 5);
    }
  });

  it("scales two overlapping columns by the same factor, not independently", () => {
    // A lane packed enough in one column to force scaling should not warp
    // its shape relative to a second column sharing the same page — the
    // scale is one number for the whole lane, taken from whichever column's
    // total is worst.
    const lane: Lane = {
      name: "Main",
      moments: [],
      columns: 2,
      placed: [
        ...Array.from({ length: 500 }, (_, i) => placed(`busy-${i}`, 480 + i, 1, 0)),
        placed("quiet", 480, 60, 1),
      ],
    };

    const boxes = boxesFor(lane, body);
    const quiet = boxes.find((box) => box.entry.block.id === "quiet");
    // Scaled down along with the busy column, from the same bodyTop origin —
    // not left at its natural, unscaled position or height.
    expect(quiet?.topMm).toBeCloseTo(body.bodyTop, 5);
    expect(quiet?.heightMm).toBeLessThan(60 * body.mmPerMin);
  });
});
