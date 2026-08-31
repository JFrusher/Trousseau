import { describe, expect, it } from "vitest";
import { emptyDoc, sampleDoc } from "../model/defaults";
import type { Block, TimelineDoc } from "../model/types";
import { byId, byLane, resolve } from "./resolve";

function block(overrides: Partial<Block> & { id: string }): Block {
  return {
    label: overrides.id,
    durationMin: 30,
    anchorMin: null,
    gapMin: 0,
    bufferMin: 0,
    lane: "Main day",
    tags: [],
    location: "",
    notes: "",
    outputs: ["run-sheet"],
    ...overrides,
  };
}

function docOf(blocks: Block[]): TimelineDoc {
  return { ...emptyDoc(), blocks };
}

describe("resolve", () => {
  it("accumulates a chain of floating blocks", () => {
    const resolved = resolve(
      docOf([
        block({ id: "a", anchorMin: 480, durationMin: 60 }),
        block({ id: "b", durationMin: 30 }),
        block({ id: "c", durationMin: 45, gapMin: 15 }),
      ]),
    );
    expect(resolved.map((r) => [r.startMin, r.endMin])).toEqual([
      [480, 540],
      [540, 570],
      [585, 630],
    ]);
  });

  it("counts the buffer into the end, and the next block follows the buffer", () => {
    const resolved = resolve(
      docOf([
        block({ id: "a", anchorMin: 600, durationMin: 30, bufferMin: 10 }),
        block({ id: "b", durationMin: 20 }),
      ]),
    );
    const map = byId(resolved);
    expect(map.get("a")).toMatchObject({ startMin: 600, contentEndMin: 630, endMin: 640 });
    expect(map.get("b")).toMatchObject({ startMin: 640, endMin: 660 });
  });

  it("resets the running time at an anchor mid-chain", () => {
    const resolved = resolve(
      docOf([
        block({ id: "a", anchorMin: 480, durationMin: 60 }),
        block({ id: "b", durationMin: 30 }),
        block({ id: "c", anchorMin: 780, durationMin: 30 }),
        block({ id: "d", durationMin: 15 }),
      ]),
    );
    const map = byId(resolved);
    expect(map.get("c")?.startMin).toBe(780);
    // d follows the anchor, not the earlier chain.
    expect(map.get("d")?.startMin).toBe(810);
  });

  it("keeps lanes independent", () => {
    const resolved = resolve(
      docOf([
        block({ id: "a", lane: "Main day", anchorMin: 480, durationMin: 600 }),
        block({ id: "b", lane: "Suppliers", anchorMin: 420, durationMin: 60 }),
        block({ id: "c", lane: "Suppliers", durationMin: 30 }),
      ]),
    );
    expect(byId(resolved).get("c")?.startMin).toBe(480);
  });

  it("starts a lane that opens with a floating block at its gap", () => {
    const resolved = resolve(docOf([block({ id: "a", gapMin: 540, durationMin: 30 })]));
    expect(resolved[0]?.startMin).toBe(540);
  });

  it("returns nothing for an empty document", () => {
    expect(resolve(emptyDoc())).toEqual([]);
    expect(byLane(resolve(emptyDoc())).size).toBe(0);
  });

  it("resolves past midnight without wrapping", () => {
    const resolved = resolve(
      docOf([block({ id: "a", anchorMin: 1470, durationMin: 45 })]),
    );
    expect(resolved[0]?.endMin).toBe(1515);
  });

  it("resolves the sample day to its documented clock times", () => {
    const map = byId(resolve(sampleDoc()));
    expect(map.get("blk-prep")).toMatchObject({ startMin: 480, endMin: 660 });
    expect(map.get("blk-travel")).toMatchObject({ startMin: 660, endMin: 700 });
    expect(map.get("blk-ceremony")).toMatchObject({ startMin: 810, endMin: 855 });
    expect(map.get("blk-portraits")).toMatchObject({ startMin: 975, endMin: 1005 });
    expect(map.get("blk-carriages")).toMatchObject({ startMin: 1480, endMin: 1500 });
  });

  it("groups by lane in document order", () => {
    const lanes = byLane(resolve(sampleDoc()));
    expect([...lanes.keys()]).toEqual(["Main day", "Suppliers", "Transport"]);
    const main = lanes.get("Main day") ?? [];
    expect(main.map((entry) => entry.laneIndex)).toEqual(main.map((_, index) => index));
  });

  it("does not mutate the document", () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    resolve(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("squeeze", () => {
  it("takes an overrun out of the squeezable blocks before the next anchor", () => {
    const resolved = byId(
      resolve(
        docOf([
          block({ id: "a", anchorMin: 480, durationMin: 60 }),
          block({ id: "b", durationMin: 60, squeezeToMin: 30 }),
          block({ id: "c", durationMin: 60, squeezeToMin: 30 }),
          block({ id: "d", anchorMin: 630, durationMin: 30 }),
        ]),
      ),
    );

    // 480 + 60 + 60 + 60 = 660, which is 30 past d's anchor. b and c have 30
    // minutes of give each, so they lose 15 apiece and the day lands on time.
    expect(resolved.get("b")?.squeezedMin).toBe(15);
    expect(resolved.get("c")?.squeezedMin).toBe(15);
    expect(resolved.get("c")?.endMin).toBe(630);
  });

  it("leaves blocks that cannot squeeze alone, and reports what it could not take", () => {
    const resolved = byId(
      resolve(
        docOf([
          block({ id: "a", anchorMin: 480, durationMin: 60 }),
          block({ id: "b", durationMin: 60 }),
          block({ id: "c", durationMin: 60, squeezeToMin: 50 }),
          block({ id: "d", anchorMin: 600, durationMin: 30 }),
        ]),
      ),
    );

    expect(resolved.get("b")?.squeezedMin).toBe(0);
    expect(resolved.get("c")?.squeezedMin).toBe(10);
    // 60 minutes over, only 10 of them squeezable: the rest still collides.
    expect(resolved.get("c")?.endMin).toBe(650);
  });

  it("never squeezes past the floor, and squeezes nothing when the day fits", () => {
    const resolved = byId(
      resolve(
        docOf([
          block({ id: "a", anchorMin: 480, durationMin: 60, squeezeToMin: 30 }),
          block({ id: "b", durationMin: 30, squeezeToMin: 10 }),
          block({ id: "c", anchorMin: 600, durationMin: 30 }),
        ]),
      ),
    );
    expect(resolved.get("a")?.squeezedMin).toBe(0);
    expect(resolved.get("b")?.squeezedMin).toBe(0);
    expect(resolved.get("b")?.endMin).toBe(570);
  });

  it("squeezes the anchored head of a stretch too, without moving its start", () => {
    const resolved = byId(
      resolve(
        docOf([
          block({ id: "a", anchorMin: 480, durationMin: 60, squeezeToMin: 40 }),
          block({ id: "b", anchorMin: 520, durationMin: 30 }),
        ]),
      ),
    );
    expect(resolved.get("a")?.startMin).toBe(480);
    expect(resolved.get("a")?.squeezedMin).toBe(20);
    expect(resolved.get("a")?.endMin).toBe(520);
  });

  it("keeps the contingency buffer out of it", () => {
    const resolved = byId(
      resolve(
        docOf([
          block({ id: "a", anchorMin: 480, durationMin: 60, bufferMin: 30, squeezeToMin: 30 }),
          block({ id: "b", anchorMin: 550, durationMin: 30 }),
        ]),
      ),
    );
    // 20 minutes over; the buffer stays 30 and the duration gives way instead.
    expect(resolved.get("a")?.squeezedMin).toBe(20);
    expect(resolved.get("a")?.contentEndMin).toBe(520);
    expect(resolved.get("a")?.endMin).toBe(550);
  });
});
