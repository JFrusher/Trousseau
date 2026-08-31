import { describe, expect, it } from "vitest";
import { emptyDoc } from "../model/defaults";
import type { Block, TimelineDoc } from "../model/types";
import { conflicts } from "./conflicts";
import { resolve } from "./resolve";
import { slack } from "./slack";

const LANES = ["Main day", "Suppliers", "Transport", "Children"];

function bigDoc(count: number): TimelineDoc {
  const blocks: Block[] = [];
  for (let i = 0; i < count; i += 1) {
    const lane = LANES[i % LANES.length] as string;
    blocks.push({
      id: `blk-${i}`,
      label: `Block ${i}`,
      durationMin: 15,
      // Every fifth block is anchored, so the anchor logic is exercised too.
      anchorMin: i % 5 === 0 ? 420 + Math.floor(i / LANES.length) * 20 : null,
      gapMin: 5,
      bufferMin: i % 7 === 0 ? 5 : 0,
      lane,
      tags: [["photographer", "band", "caterer", "florist"][i % 4] as string],
      location: "Great hall",
      notes: "",
      outputs: ["run-sheet"],
    });
  }
  return { ...emptyDoc(), lanes: LANES, blocks };
}

describe("scheduling performance", () => {
  it("resolves, checks and measures 200 blocks well inside a frame", () => {
    const doc = bigDoc(200);
    const runs: number[] = [];

    for (let i = 0; i < 50; i += 1) {
      const started = performance.now();
      const resolved = resolve(doc);
      conflicts(resolved, doc, { goldenHourEndMin: 1230 });
      slack(resolved, doc);
      runs.push(performance.now() - started);
    }

    runs.sort((a, b) => a - b);
    const median = runs[Math.floor(runs.length / 2)] as number;
    console.log(`200 blocks: median ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(16);
  });
});
