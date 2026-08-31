import { describe, expect, it } from "vitest";
import { canRedo, canUndo, HISTORY_LIMIT, initHistory, push, redo, reset, undo } from "./history";

describe("history", () => {
  it("returns to the same value through undo and redo", () => {
    let history = initHistory("a");
    history = push(history, "b");
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    history = redo(history);
    expect(history.present).toBe("b");
  });

  it("caps at fifty entries", () => {
    let history = initHistory(0);
    for (let i = 1; i <= 60; i += 1) history = push(history, i);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.present).toBe(60);
    // The oldest states have been dropped, not the newest.
    expect(history.past[0]).toBe(10);
  });

  it("clears redo on a new edit", () => {
    let history = push(push(initHistory("a"), "b"), "c");
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = push(history, "d");
    expect(canRedo(history)).toBe(false);
    expect(history.future).toEqual([]);
  });

  it("does nothing at the ends", () => {
    const empty = initHistory("a");
    expect(canUndo(empty)).toBe(false);
    expect(undo(empty)).toBe(empty);
    expect(redo(empty)).toBe(empty);
  });

  it("ignores a push of the identical value", () => {
    const history = initHistory("a");
    expect(push(history, "a")).toBe(history);
  });

  it("drops history on reset", () => {
    const history = push(initHistory("a"), "b");
    expect(canUndo(reset(history.present))).toBe(false);
  });
});
