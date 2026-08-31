import { isMoment, type Block, type TimelineDoc } from "../model/types";

export interface ResolvedBlock {
  id: string;
  lane: string;
  /** Position within its lane, in document order. */
  laneIndex: number;
  startMin: number;
  /** End of the block's own duration, before any buffer. */
  contentEndMin: number;
  /** End including the contingency buffer. This is what the next block follows. */
  endMin: number;
  anchored: boolean;
  /**
   * Minutes taken off this block's duration to make a downstream anchor. Zero
   * for the ordinary case. Anything that prints a duration must print
   * `contentEndMin - startMin`, not the block's own `durationMin`, or the paper
   * will disagree with the clock beside it.
   */
  squeezedMin: number;
}

/**
 * The one load-bearing function. Per lane, in document order: an anchored block
 * starts at its anchor, a floating block starts at its predecessor's end plus
 * its gap. Pure — the screen and every PDF read this and nothing else.
 *
 * A lane is walked in stretches, each running from one anchored block up to the
 * next. Where a stretch overruns the anchor waiting at its end, the overrun
 * comes out of whatever in it is marked squeezable (`squeezeToMin`), and what
 * cannot be taken is left to be reported as the collision it is. Nothing here
 * edits the document: `durationMin` stays the time the user asked for.
 */
export function resolve(doc: TimelineDoc): ResolvedBlock[] {
  const placed = new Map<string, ResolvedBlock>();

  for (const [lane, blocks] of laneOrder(doc)) {
    let cursor: number | undefined;

    for (let head = 0; head < blocks.length; ) {
      let next = head + 1;
      while (next < blocks.length && blocks[next]?.anchorMin === null) next += 1;

      const stretch = blocks.slice(head, next);
      const nextAnchorMin = blocks[next]?.anchorMin ?? null;

      // Lay it out as asked, then again minus whatever it has to give back.
      const asked = lay(stretch, lane, head, cursor, new Map());
      const overrunMin = nextAnchorMin === null ? 0 : asked.endMin - nextAnchorMin;
      const final =
        overrunMin > 0 ? lay(stretch, lane, head, cursor, share(stretch, overrunMin)) : asked;

      for (const entry of final.entries) placed.set(entry.id, entry);
      cursor = final.endMin;
      head = next;
    }
  }

  // Document order out, whatever order the lanes were walked in.
  return doc.blocks.flatMap((block) => {
    const entry = placed.get(block.id);
    return entry ? [entry] : [];
  });
}

/** The document's blocks grouped by lane, each group in document order. */
function laneOrder(doc: TimelineDoc): Map<string, Block[]> {
  const lanes = new Map<string, Block[]>();
  for (const block of doc.blocks) {
    const group = lanes.get(block.lane);
    if (group) group.push(block);
    else lanes.set(block.lane, [block]);
  }
  return lanes;
}

/** Places one stretch, each block shortened by whatever `squeezed` says. */
function lay(
  stretch: Block[],
  lane: string,
  firstIndex: number,
  cursorBefore: number | undefined,
  squeezed: Map<string, number>,
): { entries: ResolvedBlock[]; endMin: number } {
  let cursor = cursorBefore;
  const entries = stretch.map((block, offset) => {
    const startMin =
      block.anchorMin ?? (cursor === undefined ? block.gapMin : cursor + block.gapMin);
    const squeezedMin = squeezed.get(block.id) ?? 0;
    const contentEndMin = startMin + block.durationMin - squeezedMin;
    const endMin = contentEndMin + block.bufferMin;
    // A moment anchored inside something already running must not drag the lane
    // back to its own instant: what follows still follows the block it is in.
    cursor = isMoment(block) && cursor !== undefined ? Math.max(cursor, endMin) : endMin;

    return {
      id: block.id,
      lane,
      laneIndex: firstIndex + offset,
      startMin,
      contentEndMin,
      endMin,
      anchored: block.anchorMin !== null,
      squeezedMin,
    };
  });

  return { entries, endMin: cursor ?? 0 };
}

/**
 * How many minutes each squeezable block gives up, in proportion to how much
 * give it has — so a long block loses more than a short one, and nothing is
 * shortened past its floor. Fractions are handed out a minute at a time to the
 * blocks with the most room, so the shares always add up to what was asked for.
 */
function share(stretch: Block[], overrunMin: number): Map<string, number> {
  const room = new Map<string, number>();
  for (const block of stretch) {
    const floor = block.squeezeToMin;
    if (floor === null || floor === undefined) continue;
    const give = Math.max(0, Math.round(block.durationMin - floor));
    if (give > 0) room.set(block.id, give);
  }

  const total = [...room.values()].reduce((sum, give) => sum + give, 0);
  if (total === 0) return new Map();

  const take = Math.min(overrunMin, total);
  const shares = new Map<string, number>();
  let handed = 0;
  for (const [id, give] of room) {
    const part = Math.floor((take * give) / total);
    shares.set(id, part);
    handed += part;
  }

  for (const [id, give] of [...room].sort((a, b) => b[1] - a[1])) {
    if (handed >= take) break;
    const part = shares.get(id) ?? 0;
    if (part >= give) continue;
    shares.set(id, part + 1);
    handed += 1;
  }

  return shares;
}

/** Resolved blocks keyed by block id. */
export function byId(resolved: ResolvedBlock[]): Map<string, ResolvedBlock> {
  return new Map(resolved.map((entry) => [entry.id, entry]));
}

/** Resolved blocks grouped by lane, each group in document order. */
export function byLane(resolved: ResolvedBlock[]): Map<string, ResolvedBlock[]> {
  const lanes = new Map<string, ResolvedBlock[]>();
  for (const entry of resolved) {
    const group = lanes.get(entry.lane);
    if (group) group.push(entry);
    else lanes.set(entry.lane, [entry]);
  }
  return lanes;
}

/** The document's blocks keyed by id, for looking up what a resolved entry came from. */
export function blocksById(doc: TimelineDoc): Map<string, Block> {
  return new Map(doc.blocks.map((block) => [block.id, block]));
}
