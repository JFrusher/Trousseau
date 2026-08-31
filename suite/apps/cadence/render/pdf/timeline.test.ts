import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import { nodeFontSource } from "./nodeFontSource";
import { textOf } from "./readPdf";
import { renderTimeline } from "./timeline";

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

  it("renders an empty day without falling over", async () => {
    const { pages } = await textOf(await renderTimeline({ ...sampleDoc(), blocks: [] }, options));
    expect(pages).toBe(1);
  });
});
