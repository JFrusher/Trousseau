import { describe, expect, it } from "vitest";
import { sampleDoc } from "../model/defaults";
import { isMoment, type Block, type TimelineDoc } from "../model/types";
import { blockingConflicts, conflicts } from "./conflicts";
import { byId, resolve } from "./resolve";

function moment(id: string, lane: string, patch: Partial<Block> = {}): Block {
  return {
    id,
    label: id,
    durationMin: 0,
    anchorMin: null,
    gapMin: 0,
    bufferMin: 0,
    lane,
    tags: [],
    location: "",
    notes: "",
    outputs: ["run-sheet"],
    ...patch,
  };
}

function withBlocks(doc: TimelineDoc, blocks: Block[]): TimelineDoc {
  return { ...doc, blocks };
}

describe("moments", () => {
  it("is a block with no length", () => {
    expect(isMoment({ durationMin: 0 })).toBe(true);
    expect(isMoment({ durationMin: 5 })).toBe(false);
  });

  it("starts and ends on the same minute", () => {
    const doc = sampleDoc();
    const entry = byId(resolve(doc)).get("blk-rings");
    expect(entry?.startMin).toBe(795);
    expect(entry?.endMin).toBe(795);
    expect(entry?.contentEndMin).toBe(795);
  });

  it("costs its lane nothing, so what follows does not move", () => {
    const doc = sampleDoc();
    const after = byId(resolve(doc)).get("blk-ceremony")?.startMin;

    const without = withBlocks(doc, doc.blocks.filter((block) => block.id !== "blk-rings"));
    expect(byId(resolve(without)).get("blk-ceremony")?.startMin).toBe(after);
  });

  it("does not drag its lane back when it is pinned inside a running block", () => {
    const doc = sampleDoc();
    const base = withBlocks(doc, [
      moment("blk-long", "Main day", { durationMin: 120, anchorMin: 600, label: "Long thing" }),
      moment("blk-next", "Main day", { durationMin: 30, label: "The one after" }),
    ]);
    const pinned = withBlocks(base, [
      base.blocks[0] as Block,
      moment("blk-mid", "Main day", { anchorMin: 630 }),
      base.blocks[1] as Block,
    ]);

    // Without the moment the follower starts at 12:00; the moment must not
    // pull it back to 10:30 just because that is where the moment sits.
    expect(byId(resolve(base)).get("blk-next")?.startMin).toBe(720);
    expect(byId(resolve(pinned)).get("blk-next")?.startMin).toBe(720);
    expect(conflicts(resolve(pinned), pinned)).toEqual([]);
  });

  it("still lets a real overlap through when it sits between the two blocks", () => {
    const doc = sampleDoc();
    const clashing = withBlocks(doc, [
      moment("blk-first", "Main day", { durationMin: 60, anchorMin: 600, label: "First" }),
      moment("blk-mid", "Main day", { anchorMin: 630 }),
      moment("blk-second", "Main day", { durationMin: 30, anchorMin: 630, label: "Second" }),
    ]);

    const found = conflicts(resolve(clashing), clashing);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("lane-overlap");
    expect(found[0]?.blockIds).toEqual(["blk-first", "blk-second"]);
  });

  it("raises a tag clash as an advisory, so it never blocks the print run", () => {
    const doc = sampleDoc();
    const both = withBlocks(doc, [
      moment("blk-busy", "Main day", { durationMin: 60, anchorMin: 600, tags: ["photographer"] }),
      moment("blk-point", "Suppliers", { anchorMin: 630, tags: ["photographer"] }),
    ]);

    const found = conflicts(resolve(both), both);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("tag-double-booked");
    expect(found[0]?.severity).toBe("advisory");
    expect(blockingConflicts(found)).toEqual([]);
  });
});
