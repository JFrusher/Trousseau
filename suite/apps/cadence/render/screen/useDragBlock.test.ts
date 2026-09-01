// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import { getDoc, useStore } from "../../state/store";
import { minutesFromDelta, SNAP_MIN } from "./useDragBlock";

describe("minutesFromDelta", () => {
  it("converts pixels dragged down the page to minutes", () => {
    // Down the page is later, so a positive delta is a later time.
    expect(minutesFromDelta(60, 1)).toBe(60);
    expect(minutesFromDelta(60, 2)).toBe(30);
    expect(minutesFromDelta(-60, 2)).toBe(-30);
  });

  it("snaps to five minute marks", () => {
    expect(minutesFromDelta(7, 1)).toBe(5);
    expect(minutesFromDelta(13, 1)).toBe(15);
    expect(minutesFromDelta(2, 1)).toBe(0);
    expect(minutesFromDelta(1000, 1) % SNAP_MIN).toBe(0);
  });

  it("does not divide by a zoom of zero", () => {
    expect(minutesFromDelta(100, 0)).toBe(0);
  });
});

describe("drag through the store", () => {
  beforeEach(() => {
    useStore.getState().loadDoc(sampleDoc());
  });

  it("previews without changing the document, and cancels clean", () => {
    const before = getDoc(useStore.getState());
    useStore.getState().previewChange({ type: "shift", blockId: "blk-ceremony", deltaMin: 20 });
    expect(useStore.getState().preview?.movedIds).toContain("blk-confetti");
    expect(getDoc(useStore.getState())).toBe(before);

    useStore.getState().cancelPreview();
    expect(getDoc(useStore.getState())).toBe(before);
    expect(useStore.getState().canUndo()).toBe(false);
  });

  it("commits one undoable edit when the drag ends", () => {
    useStore.getState().previewChange({ type: "shift", blockId: "blk-ceremony", deltaMin: 20 });
    useStore.getState().commitPreview();
    expect(getDoc(useStore.getState()).blocks.find((b) => b.id === "blk-ceremony")?.anchorMin).toBe(830);
    expect(useStore.getState().canUndo()).toBe(true);
    useStore.getState().undo();
    expect(getDoc(useStore.getState()).blocks.find((b) => b.id === "blk-ceremony")?.anchorMin).toBe(810);
  });

  it("moves a block to a later time when dragged downward", () => {
    useStore.getState().loadDoc(sampleDoc());
    const downward = minutesFromDelta(26, 1.3);
    useStore.getState().previewChange({ type: "shift", blockId: "blk-ceremony", deltaMin: downward });
    useStore.getState().commitPreview();
    expect(getDoc(useStore.getState()).blocks.find((b) => b.id === "blk-ceremony")?.anchorMin).toBe(830);
  });
});
