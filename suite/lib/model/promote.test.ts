import { describe, expect, it } from "vitest";
import { promoteSources } from "./promote";

/**
 * The failure this prevents: a collected file restores without error, reports
 * success, and leaves an empty app — because the wedding was under `sources`
 * and the tools read the slices. Both shapes are called `.trousseau.json`.
 */

const collected = {
  kind: "trousseau",
  version: 1,
  event: { date: "2026-09-12", coupleNames: "Jacob and Charis", venueName: "The Hall" },
  guests: {},
  seating: {},
  day: {
    kind: "cadence.day",
    day: { date: "2026-09-12", curfewMin: 1500 },
    lanes: ["Main day", "Photo"],
    blocks: [
      { id: "b1", label: "Ceremony", lane: "Main day", startMin: 780, endMin: 840, location: "Barn" },
      { id: "b2", label: "Photos", lane: "Photo", startMin: 840, endMin: 900 },
    ],
  },
  sources: {
    tableaux: {
      meta: { weddingName: "Jacob and Charis" },
      guests: { g1: { id: "g1", firstName: "Charis" }, g2: { id: "g2", firstName: "Jacob" } },
      tables: { t1: { id: "t1", label: "Top Table" } },
      room: { spaces: [{ id: "s1", label: "Barn" }] },
    },
  },
};

describe("opening a collected wedding", () => {
  it("fills the slices the tools read", () => {
    const { raw, filled } = promoteSources(collected);

    expect(Object.keys(raw["guests"] as object)).toHaveLength(2);
    expect(Object.keys((raw["seating"] as { tables: object }).tables)).toHaveLength(1);
    expect(filled).toEqual(["2 guests", "1 tables", "2 parts of the day"]);
  });

  it("rebuilds a day that resolves to the times it already had", () => {
    const timeline = promoteSources(collected).raw["timeline"] as {
      blocks: Array<{ id: string; anchorMin: number; durationMin: number; lane: string }>;
      lanes: string[];
    };

    expect(timeline.lanes).toEqual(["Main day", "Photo"]);
    expect(timeline.blocks[0]).toMatchObject({
      id: "b1",
      anchorMin: 780,
      durationMin: 60,
      lane: "Main day",
    });
    expect(timeline.blocks[1]).toMatchObject({ id: "b2", anchorMin: 840, durationMin: 60 });
  });

  it("takes the couple and venue from the envelope, which owns them", () => {
    const timeline = promoteSources(collected).raw["timeline"] as { day: Record<string, unknown> };
    expect(timeline.day["coupleNames"]).toBe("Jacob and Charis");
    expect(timeline.day["venueName"]).toBe("The Hall");
  });

  describe("leaves a real wedding alone", () => {
    it("never overwrites a slice that has something in it", () => {
      // A collected export is a snapshot of what a tool had when it was
      // collected. On a document holding both, the slice is the newer answer.
      const { raw, filled } = promoteSources({
        ...collected,
        guests: { real: { id: "real", firstName: "Already here" } },
      });

      expect(Object.keys(raw["guests"] as object)).toEqual(["real"]);
      expect(filled).not.toContain("2 guests");
    });

    it("leaves an existing timeline alone", () => {
      const { raw } = promoteSources({
        ...collected,
        timeline: { blocks: [{ id: "mine", label: "Kept" }] },
      });
      expect((raw["timeline"] as { blocks: unknown[] }).blocks).toHaveLength(1);
    });

    it("does nothing to a document that needs nothing", () => {
      const { filled } = promoteSources({ kind: "trousseau", version: 1, guests: { g: {} } });
      expect(filled).toEqual([]);
    });
  });

  it("survives rubbish rather than throwing", () => {
    for (const junk of [null, undefined, 42, "no", []]) {
      expect(() => promoteSources(junk)).not.toThrow();
    }
  });
});
