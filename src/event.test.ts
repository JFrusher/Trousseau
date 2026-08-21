import { describe, expect, it } from "vitest";
import { eventSchema } from "./event.js";

describe("eventSchema", () => {
  it("accepts a complete event", () => {
    const parsed = eventSchema.parse({
      date: "2026-06-20",
      coupleNames: "Charis & Jacob",
      venueName: "Vane House",
      curfewMin: 1500,
      utcOffsetMin: 60,
    });
    expect(parsed.coupleNames).toBe("Charis & Jacob");
  });

  it("fills absent fields rather than rejecting a half-built event", () => {
    const parsed = eventSchema.parse({});
    expect(parsed).toEqual({
      date: "",
      coupleNames: "",
      venueName: "",
      curfewMin: null,
      utcOffsetMin: null,
    });
  });

  it("preserves keys it does not know about", () => {
    const parsed = eventSchema.parse({ coupleNames: "A & B", hashtag: "#ab2026" });
    expect(parsed).toMatchObject({ hashtag: "#ab2026" });
  });

  it("rejects a field of the wrong type", () => {
    expect(eventSchema.safeParse({ curfewMin: "late" }).success).toBe(false);
  });
});
