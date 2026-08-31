import { newId } from "@/lib/model/ids";
import { DEFAULT_BLOCK_OUTPUTS } from "@/lib/timeline/core/model/defaults";
import type { Block, TagDetail, TimelineDoc } from "@/lib/timeline/core/model/types";

/** Every change to the run of the day. Pure, like the seating actions. */

export function addBlock(doc: TimelineDoc, lane: string, afterId?: string): TimelineDoc {
  const block: Block = {
    id: newId("b"),
    label: "New block",
    durationMin: 30,
    anchorMin: null,
    gapMin: 0,
    bufferMin: 0,
    squeezeToMin: null,
    lane,
    tags: [],
    location: "",
    notes: "",
    outputs: [...DEFAULT_BLOCK_OUTPUTS],
  };

  // Document order within a lane is what the resolver walks, so a new block has
  // to land next to the one it was added from rather than at the end.
  const at = afterId ? doc.blocks.findIndex((b) => b.id === afterId) : -1;
  const blocks = [...doc.blocks];
  blocks.splice(at >= 0 ? at + 1 : blocks.length, 0, block);
  return { ...doc, blocks };
}

export function patchBlock(doc: TimelineDoc, id: string, patch: Partial<Block>): TimelineDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

export function removeBlock(doc: TimelineDoc, id: string): TimelineDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== id) };
}

/**
 * Move a block up or down within its own lane.
 *
 * Order is the whole model for floating blocks — one starts when the one before
 * it ends — so this is how the day is actually rearranged. It swaps with the
 * neighbour *in the same lane*, stepping over blocks in other lanes that happen
 * to sit between them in document order.
 */
export function moveBlock(doc: TimelineDoc, id: string, direction: -1 | 1): TimelineDoc {
  const index = doc.blocks.findIndex((b) => b.id === id);
  const block = doc.blocks[index];
  if (!block) return doc;

  let swapAt = -1;
  for (let i = index + direction; i >= 0 && i < doc.blocks.length; i += direction) {
    if (doc.blocks[i]!.lane === block.lane) {
      swapAt = i;
      break;
    }
  }
  if (swapAt < 0) return doc;

  const blocks = [...doc.blocks];
  blocks[index] = blocks[swapAt]!;
  blocks[swapAt] = block;
  return { ...doc, blocks };
}

export function addLane(doc: TimelineDoc, name: string): TimelineDoc {
  const clean = name.trim();
  if (!clean || doc.lanes.includes(clean)) return doc;
  return { ...doc, lanes: [...doc.lanes, clean] };
}

/**
 * Removing a lane moves its blocks to the first remaining one rather than
 * deleting them. The last lane cannot go: blocks must live somewhere.
 */
export function removeLane(doc: TimelineDoc, name: string): TimelineDoc {
  if (doc.lanes.length <= 1) return doc;
  const lanes = doc.lanes.filter((l) => l !== name);
  const fallback = lanes[0]!;
  return {
    ...doc,
    lanes,
    blocks: doc.blocks.map((b) => (b.lane === name ? { ...b, lane: fallback } : b)),
  };
}

export function renameLane(doc: TimelineDoc, from: string, to: string): TimelineDoc {
  const clean = to.trim();
  if (!clean || from === clean || doc.lanes.includes(clean)) return doc;
  return {
    ...doc,
    lanes: doc.lanes.map((l) => (l === from ? clean : l)),
    blocks: doc.blocks.map((b) => (b.lane === from ? { ...b, lane: clean } : b)),
  };
}

/** Every tag in use, in first-seen order. The filter chips and the crew seeds. */
export function allTags(doc: TimelineDoc): string[] {
  const seen: string[] = [];
  for (const block of doc.blocks) {
    for (const tag of block.tags) if (!seen.includes(tag)) seen.push(tag);
  }
  return seen;
}

/**
 * Record a phone number or an arrival time against a supplier tag.
 *
 * Tags are free text on the block — no entity management, no CRUD — and this is
 * the optional detail hung off one. A tag nobody uses keeps its detail, because
 * deleting the caterer's phone number when their last block moves lane would be
 * a poor trade for a tidier list.
 */
export function setTagDetail(doc: TimelineDoc, detail: TagDetail): TimelineDoc {
  const rest = doc.tagDetails.filter((d) => d.tag !== detail.tag);
  return { ...doc, tagDetails: [...rest, detail] };
}

export function removeTagDetail(doc: TimelineDoc, tag: string): TimelineDoc {
  return { ...doc, tagDetails: doc.tagDetails.filter((d) => d.tag !== tag) };
}

/** The venue's coordinates, which drive nothing but the golden-hour advisory. */
export function setVenuePosition(
  doc: TimelineDoc,
  latitude: number,
  longitude: number,
): TimelineDoc {
  return { ...doc, day: { ...doc.day, latitude, longitude } };
}
