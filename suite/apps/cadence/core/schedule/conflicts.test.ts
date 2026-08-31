import { describe, expect, it } from "vitest";
import { sampleDoc } from "../model/defaults";
import type { Block, TimelineDoc } from "../model/types";
import { conflicts, conflictsByBlock, PHOTO_TAG } from "./conflicts";
import { resolve } from "./resolve";

function edit(doc: TimelineDoc, id: string, patch: Partial<Block>): TimelineDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
  };
}

function run(doc: TimelineDoc, goldenHourEndMin?: number) {
  return conflicts(
    resolve(doc),
    doc,
    goldenHourEndMin === undefined ? {} : { goldenHourEndMin },
  );
}

describe("conflicts", () => {
  it("finds nothing wrong with the sample day", () => {
    expect(run(sampleDoc())).toEqual([]);
  });

  it("reports a lane overlap between two anchored blocks", () => {
    const doc = edit(sampleDoc(), "blk-ceremony", { anchorMin: 780 });
    const found = run(doc);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("lane-overlap");
    expect(found[0]?.blockIds).toEqual(["blk-guests", "blk-ceremony"]);
    expect(found[0]?.severity).toBe("conflict");
  });

  it("reports a tag in two lanes at once, exactly once", () => {
    const doc = sampleDoc();
    const clash: Block = {
      id: "blk-photoclash",
      label: "Second shooter briefing",
      durationMin: 20,
      anchorMin: 950,
      gapMin: 0,
      bufferMin: 0,
      lane: "Suppliers",
      tags: ["photographer"],
      location: "Kitchen",
      notes: "",
      outputs: ["run-sheet", "call-sheet"],
    };
    // Inserted in its lane's chronological position, so the only fault is the clash.
    const at = doc.blocks.findIndex((b) => b.id === "blk-caterer") + 1;
    const blocks = [...doc.blocks.slice(0, at), clash, ...doc.blocks.slice(at)];
    const found = run({ ...doc, blocks });
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("tag-double-booked");
    expect(found[0]?.blockIds.sort()).toEqual(["blk-groups", "blk-photoclash"]);
  });

  it("does not double-report a same-lane clash as a tag clash", () => {
    const doc = edit(sampleDoc(), "blk-ceremony", { anchorMin: 780 });
    // Guests arrive and Ceremony are both in Main day; only the lane collision counts.
    expect(run(doc).filter((c) => c.kind === "tag-double-booked")).toEqual([]);
  });

  it("reports a floating chain running into a downstream anchor", () => {
    const doc = edit(sampleDoc(), "blk-cake", { durationMin: 60 });
    const found = run(doc);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("anchor-collision");
    expect(found[0]?.blockIds).toEqual(["blk-cake", "blk-firstdance"]);
  });

  it("reports a curfew overrun", () => {
    const doc = edit(sampleDoc(), "blk-carriages", { durationMin: 60 });
    const found = run(doc);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("curfew-overrun");
    expect(found[0]?.blockIds).toEqual(["blk-carriages"]);
  });

  it("raises a golden hour advisory without blocking", () => {
    // A day with nothing but the late portraits, so the advisory stands alone.
    const doc = sampleDoc();
    const portraits = doc.blocks.find((b) => b.id === "blk-portraits") as Block;
    const found = run({ ...doc, blocks: [{ ...portraits, anchorMin: 1320 }] }, 1230);
    const advisories = found.filter((c) => c.severity === "advisory");
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.kind).toBe("past-golden-hour");
    expect(found.filter((c) => c.severity === "conflict")).toEqual([]);
  });

  it("leaves the sample day clear of advisories in June light", () => {
    expect(run(sampleDoc(), 1230)).toEqual([]);
  });

  it("only treats tagged photo blocks as photography", () => {
    const doc = edit(sampleDoc(), "blk-portraits", { anchorMin: 1320, tags: ["photographer"] });
    expect(run(doc, 1230).filter((c) => c.kind === "past-golden-hour")).toEqual([]);
    expect(PHOTO_TAG).toBe("photo");
  });

  it("indexes conflicts by block", () => {
    const doc = edit(sampleDoc(), "blk-ceremony", { anchorMin: 780 });
    const index = conflictsByBlock(run(doc));
    expect(index.get("blk-guests")).toHaveLength(1);
    expect(index.get("blk-ceremony")).toHaveLength(1);
    expect(index.get("blk-confetti")).toBeUndefined();
  });
});
