import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("is unique across a thousand calls and keeps its prefix", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const id = newId("blk");
      expect(id.startsWith("blk-")).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });
});
