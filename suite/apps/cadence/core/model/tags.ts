import type { Block, TagDetail, TimelineDoc } from "./types";

export interface TagSummary {
  tag: string;
  /** How many blocks carry it. Zero means the detail has outlived its blocks. */
  count: number;
  detail: TagDetail | null;
  orphan: boolean;
}

/**
 * Every tag in the document, whether it came from a block or from a detail
 * record. A detail whose last block has gone is kept and flagged, never
 * silently deleted — the phone number is the part that is hard to get back.
 */
export function allTags(doc: TimelineDoc): TagSummary[] {
  const counts = new Map<string, number>();
  for (const block of doc.blocks) {
    for (const tag of block.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const details = new Map(doc.tagDetails.map((detail) => [detail.tag, detail]));
  const names = new Set([...counts.keys(), ...details.keys()]);

  return [...names]
    .map((tag) => {
      const count = counts.get(tag) ?? 0;
      return { tag, count, detail: details.get(tag) ?? null, orphan: count === 0 };
    })
    .sort((a, b) => {
      if (a.orphan !== b.orphan) return a.orphan ? 1 : -1;
      return a.tag.localeCompare(b.tag);
    });
}

/** Blocks carrying a tag, in document order. */
export function blocksForTag(doc: TimelineDoc, tag: string): Block[] {
  return doc.blocks.filter((block) => block.tags.includes(tag));
}

/** The tags that actually appear on a block, in display order. */
export function usedTags(doc: TimelineDoc): TagSummary[] {
  return allTags(doc).filter((summary) => !summary.orphan);
}

export function detailFor(doc: TimelineDoc, tag: string): TagDetail | null {
  return doc.tagDetails.find((detail) => detail.tag === tag) ?? null;
}

/** What to print for a tag: its display name if it has one, else the tag. */
export function tagLabel(doc: TimelineDoc, tag: string): string {
  return detailFor(doc, tag)?.displayName || tag;
}
