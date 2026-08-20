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

  it("accepts a day with no version at all, as Brigade does", () => {
    const noVersion = { ...(fixture("minimal.day.json") as Record<string, unknown>) };
    delete noVersion["version"];
    const parsed = daySchema.parse(noVersion);
    expect(parsed.version).toBe(0);
  });

  it("drops a malformed team rather than refusing the file, as Brigade does", () => {
    const parsed = daySchema.parse({
      ...(fixture("minimal.day.json") as object),
      teams: [{ tag: "florist" }, { displayName: "no tag here" }, "not an object"],
    });
    expect(parsed.teams).toHaveLength(1);
    expect(parsed.teams[0]?.tag).toBe("florist");
  });

  it("filters non-string tags and lanes rather than refusing the file, as Brigade does", () => {
    const parsed = daySchema.parse({
      ...(fixture("minimal.day.json") as object),
      lanes: ["Main day", 7, null],
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, tags: ["a", 3] }],
    });
    expect(parsed.lanes).toEqual(["Main day"]);
    expect(parsed.blocks[0]?.tags).toEqual(["a"]);
  });

  it("reads a non-boolean anchored as false rather than refusing the file", () => {
    const parsed = daySchema.parse({
      ...(fixture("minimal.day.json") as object),
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, anchored: "yes" }],
    });
    expect(parsed.blocks[0]?.anchored).toBe(false);
  });

  it("coerces a non-number version to 0, as Brigade does", () => {
    const parsed = daySchema.parse({ ...(fixture("minimal.day.json") as object), version: "1" });
    expect(parsed.version).toBe(0);
  });

  it("reads a non-array lanes or tags as empty, as Brigade does", () => {
    const parsed = daySchema.parse({
      ...(fixture("minimal.day.json") as object),
      lanes: "Main day",
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, tags: "photographer" }],
    });
    expect(parsed.lanes).toEqual([]);
    expect(parsed.blocks[0]?.tags).toEqual([]);
  });

  it("reads a non-array teams as empty, as Brigade does", () => {
    const parsed = daySchema.parse({ ...(fixture("minimal.day.json") as object), teams: "florist" });
    expect(parsed.teams).toEqual([]);
  });

  it("coerces a non-string appVersion to empty, as Brigade does", () => {
    const parsed = daySchema.parse({ ...(fixture("minimal.day.json") as object), appVersion: 7 });
    expect(parsed.appVersion).toBe("");
  });

  it("reads a non-boolean moment as false, as Brigade does", () => {
    const parsed = daySchema.parse({
      ...(fixture("minimal.day.json") as object),
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, moment: "yes" }],
    });
    expect(parsed.blocks[0]?.moment).toBe(false);
  });
});
