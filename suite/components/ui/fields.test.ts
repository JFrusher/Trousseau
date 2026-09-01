import { describe, expect, it } from "vitest";
import { commitNumber } from "./fields";

describe("commitNumber", () => {
  it("takes a number that is in range", () => {
    expect(commitNumber("90", 0)).toBe(90);
    expect(commitNumber("0", 0)).toBe(0); // a deliberate zero still lands
  });

  it("holds an emptied box rather than committing a zero", () => {
    // Backspacing "180" away must not turn the block into a moment mid-type.
    expect(commitNumber("", 0)).toBeNull();
    expect(commitNumber("   ", 0)).toBeNull();
  });

  it("holds text that is not a number", () => {
    expect(commitNumber("-", 0)).toBeNull();
    expect(commitNumber("12min", 0)).toBeNull();
  });

  it("holds anything outside the bounds", () => {
    expect(commitNumber("-5", 0)).toBeNull();
    expect(commitNumber("200", 0, 180)).toBeNull();
    expect(commitNumber("180", 0, 180)).toBe(180);
  });
})
