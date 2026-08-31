import { describe, expect, it } from "vitest";
import { sampleDoc } from "./defaults";
import { allTags, blocksForTag, detailFor, tagLabel, usedTags } from "./tags";

describe("allTags", () => {
  it("counts every tag on a block", () => {
    const tags = allTags(sampleDoc());
    const photographer = tags.find((entry) => entry.tag === "photographer");
    expect(photographer?.count).toBe(6);
    expect(photographer?.orphan).toBe(false);
    expect(photographer?.detail?.phone).toBe("07700 900141");
  });

  it("keeps a tag with no detail", () => {
    const photo = allTags(sampleDoc()).find((entry) => entry.tag === "photo");
    expect(photo?.count).toBe(1);
    expect(photo?.detail).toBeNull();
  });

  it("orphans a detail whose last block has gone, keeping the phone number", () => {
    const doc = sampleDoc();
    const stripped = {
      ...doc,
      blocks: doc.blocks.map((block) => ({
        ...block,
        tags: block.tags.filter((tag) => tag !== "florist"),
      })),
    };
    const florist = allTags(stripped).find((entry) => entry.tag === "florist");
    expect(florist?.count).toBe(0);
    expect(florist?.orphan).toBe(true);
    expect(florist?.detail?.phone).toBe("07700 900455");
    expect(stripped.tagDetails.some((detail) => detail.tag === "florist")).toBe(true);
  });

  it("sorts used tags first, then orphans, alphabetically within each", () => {
    const doc = sampleDoc();
    const stripped = {
      ...doc,
      blocks: doc.blocks.map((block) => ({
        ...block,
        tags: block.tags.filter((tag) => tag !== "florist"),
      })),
    };
    const tags = allTags(stripped);
    expect(tags[tags.length - 1]?.tag).toBe("florist");
    const used = tags.filter((entry) => !entry.orphan).map((entry) => entry.tag);
    expect(used).toEqual([...used].sort());
  });

  it("excludes orphans from usedTags", () => {
    expect(usedTags(sampleDoc()).every((entry) => entry.count > 0)).toBe(true);
  });
});

describe("blocksForTag", () => {
  it("returns the tagged blocks in document order", () => {
    const blocks = blocksForTag(sampleDoc(), "band");
    expect(blocks.map((block) => block.id)).toEqual([
      "blk-firstdance",
      "blk-lastdance",
      "blk-bandsetup",
      "blk-soundcheck",
      "blk-bandset1",
      "blk-bandset2",
    ]);
  });
});

describe("tagLabel", () => {
  it("prefers the display name and falls back to the tag", () => {
    expect(tagLabel(sampleDoc(), "band")).toBe("The Wrights");
    expect(tagLabel(sampleDoc(), "photo")).toBe("photo");
    expect(detailFor(sampleDoc(), "nobody")).toBeNull();
  });
});
