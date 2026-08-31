import { describe, expect, it } from "vitest";
import { sampleDoc } from "../model/defaults";
import type { Block, TimelineDoc } from "../model/types";
import { conflicts } from "./conflicts";
import { resolve } from "./resolve";
import { slack } from "./slack";

function edit(doc: TimelineDoc, id: string, patch: Partial<Block>): TimelineDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
  };
}

function report(doc: TimelineDoc) {
  return slack(resolve(doc), doc);
}

describe("slack", () => {
  it("measures headroom to the next anchor in the lane", () => {
    const { byBlock } = report(sampleDoc());
    // Cake cutting ends 20:00, the first dance is anchored at 20:30.
    expect(byBlock.get("blk-cake")).toBe(30);
    // Every block in the same segment shares that headroom.
    expect(byBlock.get("blk-speeches")).toBe(30);
  });

  it("is null when nothing downstream is anchored", () => {
    expect(report(sampleDoc()).byBlock.get("blk-carriages")).toBeNull();
  });

  it("shrinks by exactly the minutes added to any block in the segment", () => {
    const before = report(sampleDoc()).byBlock.get("blk-cake") as number;
    const after = report(edit(sampleDoc(), "blk-speeches", { durationMin: 60 })).byBlock.get(
      "blk-cake",
    ) as number;
    expect(before - after).toBe(15);
  });

  it("counts the buffer against the headroom", () => {
    const before = report(sampleDoc()).byBlock.get("blk-cake") as number;
    const after = report(edit(sampleDoc(), "blk-cake", { bufferMin: 10 })).byBlock.get(
      "blk-cake",
    ) as number;
    expect(before - after).toBe(10);
  });

  it("reports minutes left before curfew", () => {
    const { toCurfewMin, dayEndMin } = report(sampleDoc());
    expect(dayEndMin).toBe(1500);
    expect(toCurfewMin).toBe(0);
  });

  it("goes negative in lockstep with the curfew overrun", () => {
    const doc = edit(sampleDoc(), "blk-carriages", { durationMin: 50 });
    expect(report(doc).toCurfewMin).toBe(-30);
    const overrun = conflicts(resolve(doc), doc).filter((c) => c.kind === "curfew-overrun");
    expect(overrun).toHaveLength(1);
  });

  it("handles a document with no blocks", () => {
    const doc = { ...sampleDoc(), blocks: [] };
    expect(report(doc).dayEndMin).toBe(0);
    expect(report(doc).byBlock.size).toBe(0);
  });
});
