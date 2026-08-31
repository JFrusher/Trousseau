import { describe, expect, it } from "vitest";
import { sampleDoc } from "../model/defaults";
import { byId } from "./resolve";
import { applyChange, whatIf } from "./whatIf";

describe("whatIf", () => {
  it("moves everything downstream and nothing upstream", () => {
    const doc = sampleDoc();
    const result = whatIf(doc, { type: "shift", blockId: "blk-ceremony", deltaMin: 20 });
    expect(result.movedIds).toContain("blk-ceremony");
    expect(result.movedIds).toContain("blk-confetti");
    expect(result.movedIds).toContain("blk-portraits");
    expect(result.movedIds).not.toContain("blk-guests");
    expect(result.movedIds).not.toContain("blk-prep");
    // Anchored blocks downstream hold their ground.
    expect(result.movedIds).not.toContain("blk-firstdance");
  });

  it("does not mutate the input document", () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    whatIf(doc, { type: "shift", blockId: "blk-ceremony", deltaMin: 20 });
    whatIf(doc, { type: "setDuration", blockId: "blk-cake", durationMin: 120 });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("shifts a floating block by its gap and an anchored block by its anchor", () => {
    const doc = sampleDoc();
    const floated = applyChange(doc, { type: "shift", blockId: "blk-confetti", deltaMin: 15 });
    expect(floated.blocks.find((b) => b.id === "blk-confetti")?.gapMin).toBe(15);
    const anchored = applyChange(doc, { type: "shift", blockId: "blk-ceremony", deltaMin: 15 });
    expect(anchored.blocks.find((b) => b.id === "blk-ceremony")?.anchorMin).toBe(825);
  });

  it("never drives a gap negative", () => {
    const doc = sampleDoc();
    const next = applyChange(doc, { type: "shift", blockId: "blk-confetti", deltaMin: -500 });
    expect(next.blocks.find((b) => b.id === "blk-confetti")?.gapMin).toBe(0);
  });

  it("reports only the conflicts the change introduces", () => {
    const doc = sampleDoc();
    const result = whatIf(doc, { type: "setDuration", blockId: "blk-cake", durationMin: 120 });
    expect(result.newConflicts.map((c) => c.kind)).toEqual(["anchor-collision"]);
  });

  it("does not re-report a conflict that was already there", () => {
    const broken = {
      ...sampleDoc(),
      blocks: sampleDoc().blocks.map((block) =>
        block.id === "blk-cake" ? { ...block, durationMin: 120 } : block,
      ),
    };
    const result = whatIf(broken, { type: "shift", blockId: "blk-confetti", deltaMin: 5 });
    expect(result.newConflicts).toEqual([]);
  });

  it("hands back a document ready to commit", () => {
    const result = whatIf(sampleDoc(), { type: "shift", blockId: "blk-ceremony", deltaMin: 20 });
    expect(byId(result.after).get("blk-ceremony")?.startMin).toBe(830);
    expect(result.doc.blocks.find((b) => b.id === "blk-ceremony")?.anchorMin).toBe(830);
  });
});
