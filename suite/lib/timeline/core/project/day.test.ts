import { describe, expect, it } from "vitest";
import { emptyDoc, sampleDoc } from "../model/defaults";
import { byId, resolve } from "../schedule/resolve";
import { resolvedDay, serialiseDay, suggestedDayFilename } from "./day";

describe("resolvedDay", () => {
  it("agrees with the resolver, block for block", () => {
    const doc = sampleDoc();
    const positions = byId(resolve(doc));
    const exported = resolvedDay(doc);

    expect(exported.blocks).toHaveLength(doc.blocks.length);
    for (const block of exported.blocks) {
      const entry = positions.get(block.id);
      expect(entry, `${block.id} is missing from the resolver`).toBeDefined();
      expect(block.startMin).toBe(entry?.startMin);
      expect(block.contentEndMin).toBe(entry?.contentEndMin);
      expect(block.endMin).toBe(entry?.endMin);
    }
  });

  it("carries every block, not only the ones on a printed piece", () => {
    const doc = sampleDoc();
    const hidden = {
      ...doc,
      blocks: doc.blocks.map((block) =>
        block.id === "blk-prep" ? { ...block, outputs: [] } : block,
      ),
    };
    expect(resolvedDay(hidden).blocks.map((block) => block.id)).toContain("blk-prep");
  });

  it("marks a moment, and gives it no length", () => {
    const rings = resolvedDay(sampleDoc()).blocks.find((block) => block.id === "blk-rings");
    expect(rings?.moment).toBe(true);
    expect(rings?.startMin).toBe(rings?.endMin);
  });

  it("hands over the tag details as teams", () => {
    const teams = resolvedDay(sampleDoc()).teams;
    const band = teams.find((team) => team.tag === "band");
    expect(band?.displayName).toBe("The Wrights");
    expect(band?.phone).toBe("07700 900272");
    expect(band?.arrivalMin).toBe(1080);
    // A tag with no blocks left is not a team anybody can be put on.
    expect(teams.every((team) => team.tag !== "orphaned-tag")).toBe(true);
  });

  it("survives the trip through JSON unchanged", () => {
    const doc = sampleDoc();
    expect(JSON.parse(serialiseDay(doc))).toEqual(resolvedDay(doc));
  });

  it("says what it is, so a reader can refuse the wrong file", () => {
    const exported = resolvedDay(sampleDoc());
    expect(exported.kind).toBe("cadence.day");
    expect(exported.version).toBe(1);
  });

  it("exports an empty day without falling over", () => {
    const exported = resolvedDay(emptyDoc());
    expect(exported.blocks).toEqual([]);
    expect(exported.teams).toEqual([]);
  });

  it("names the file after the couple", () => {
    expect(suggestedDayFilename(sampleDoc())).toBe("charis-and-jacob.day.json");
    expect(suggestedDayFilename(emptyDoc())).toBe("cadence-day.day.json");
  });
});
