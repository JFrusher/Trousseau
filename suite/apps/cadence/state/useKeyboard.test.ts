// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { sampleDoc } from "../core/model/defaults";
import { getDoc, useStore } from "./store";
import { handleKey } from "./useKeyboard";

function press(init: KeyboardEventInit & { target?: HTMLElement }) {
  const { target, ...rest } = init;
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...rest });
  (target ?? document.body).dispatchEvent(event);
  handleKey(event);
}

function label(id: string): string | undefined {
  return getDoc(useStore.getState()).blocks.find((block) => block.id === id)?.label;
}

beforeEach(() => {
  document.body.replaceChildren();
  useStore.getState().loadDoc(sampleDoc());
});

describe("keyboard shortcuts", () => {
  it("deletes the selected block", () => {
    useStore.getState().select("blk-cake");
    press({ key: "Delete" });
    expect(label("blk-cake")).toBeUndefined();
  });

  it("does not delete while someone is typing in a field", () => {
    const input = document.createElement("input");
    document.body.append(input);
    useStore.getState().select("blk-cake");

    press({ key: "Backspace", target: input });
    expect(label("blk-cake")).toBe("Cake cutting");
  });

  it("undoes and redoes, even from a field", () => {
    const input = document.createElement("input");
    document.body.append(input);
    useStore.getState().updateBlock("blk-ceremony", { label: "Changed" });

    press({ key: "z", ctrlKey: true, target: input });
    expect(label("blk-ceremony")).toBe("Ceremony");

    press({ key: "z", ctrlKey: true, shiftKey: true, target: input });
    expect(label("blk-ceremony")).toBe("Changed");
  });

  it("walks the lane with the arrow keys", () => {
    useStore.getState().select("blk-ceremony");
    press({ key: "ArrowRight" });
    expect(useStore.getState().selectedId).toBe("blk-confetti");
    press({ key: "ArrowLeft" });
    expect(useStore.getState().selectedId).toBe("blk-ceremony");
  });

  it("stops at the end of a lane", () => {
    useStore.getState().select("blk-carriages");
    press({ key: "ArrowRight" });
    expect(useStore.getState().selectedId).toBe("blk-carriages");
  });

  it("clears the selection on Escape, and cancels a preview first", () => {
    useStore.getState().select("blk-ceremony");
    useStore.getState().previewChange({ type: "shift", blockId: "blk-ceremony", deltaMin: 20 });

    press({ key: "Escape" });
    expect(useStore.getState().preview).toBeNull();
    expect(useStore.getState().selectedId).toBe("blk-ceremony");

    press({ key: "Escape" });
    expect(useStore.getState().selectedId).toBeNull();
  });

  it("leaves presentation mode before anything else", () => {
    useStore.getState().setUi({ presentation: true });
    useStore.getState().select("blk-ceremony");
    press({ key: "Escape" });
    expect(useStore.getState().ui.presentation).toBe(false);
    expect(useStore.getState().selectedId).toBe("blk-ceremony");
  });
});
