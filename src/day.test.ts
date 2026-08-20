import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAY_KIND, DAY_VERSION, daySchema } from "./day";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

describe("daySchema", () => {
  it("accepts the day Cadence exports today", () => {
    const parsed = daySchema.parse(fixture("sample-day.day.json"));
    expect(parsed.kind).toBe(DAY_KIND);
    expect(parsed.version).toBe(DAY_VERSION);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("accepts a day with every optional field absent, as Brigade does", () => {
    const parsed = daySchema.parse(fixture("minimal.day.json"));
    expect(parsed.appVersion).toBe("");
    expect(parsed.lanes).toEqual([]);
    expect(parsed.teams).toEqual([]);
    expect(parsed.blocks[0]).toMatchObject({
      location: "",
      notes: "",
      tags: [],
      anchored: false,
      moment: false,
    });
  });

  it("defaults contentEndMin to startMin, as Brigade does", () => {
    const parsed = daySchema.parse(fixture("minimal.day.json"));
    expect(parsed.blocks[0]?.contentEndMin).toBe(780);
  });

  it("accepts a version from the future rather than refusing it", () => {
    const future = { ...(fixture("minimal.day.json") as object), version: 99 };
    expect(daySchema.safeParse(future).success).toBe(true);
  });

  it("preserves unknown keys on the day, a block and a team", () => {
    const parsed = daySchema.parse({
      kind: "cadence.day",
      version: 1,
      day: { date: "", coupleNames: "", venueName: "", curfewMin: 0, utcOffsetMin: 0 },
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, weather: "fine" }],
      teams: [{ tag: "florist", vanRegistration: "AB12 CDE" }],
      sunsetMin: 1290,
    });
    expect(parsed).toMatchObject({ sunsetMin: 1290 });
    expect(parsed.blocks[0]).toMatchObject({ weather: "fine" });
    expect(parsed.teams[0]).toMatchObject({ vanRegistration: "AB12 CDE" });
  });

  it("rejects a file that is not a Cadence day", () => {
    expect(daySchema.safeParse({ kind: "cadence.project", version: 1 }).success).toBe(false);
  });

  it("rejects a block with no start time", () => {
    const bad = {
      kind: "cadence.day",
      version: 1,
      day: { date: "", coupleNames: "", venueName: "", curfewMin: 0, utcOffsetMin: 0 },
      blocks: [{ id: "b1", label: "L", lane: "M", endMin: 1 }],
    };
    expect(daySchema.safeParse(bad).success).toBe(false);
  });
});
