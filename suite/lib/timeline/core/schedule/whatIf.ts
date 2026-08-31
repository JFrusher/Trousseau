import type { TimelineDoc } from "../model/types";
import { conflicts, type Conflict, type ConflictOptions } from "./conflicts";
import { resolve, type ResolvedBlock } from "./resolve";

export type Change =
  | { type: "shift"; blockId: string; deltaMin: number }
  | { type: "setAnchor"; blockId: string; anchorMin: number | null }
  | { type: "setDuration"; blockId: string; durationMin: number };

/** Applies a change to a copy. The input document is never touched. */
export function applyChange(doc: TimelineDoc, change: Change): TimelineDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((block) => {
      if (block.id !== change.blockId) return block;
      switch (change.type) {
        case "shift":
          return block.anchorMin === null
            ? { ...block, gapMin: Math.max(0, block.gapMin + change.deltaMin) }
            : { ...block, anchorMin: block.anchorMin + change.deltaMin };
        case "setAnchor":
          return { ...block, anchorMin: change.anchorMin };
        case "setDuration":
          return { ...block, durationMin: Math.max(0, change.durationMin) };
      }
    }),
  };
}

export interface WhatIf {
  before: ResolvedBlock[];
  after: ResolvedBlock[];
  /** The document the change would produce, ready to commit. */
  doc: TimelineDoc;
  /** Blocks whose start time would move. */
  movedIds: string[];
  /** Conflicts the change would introduce, not ones already present. */
  newConflicts: Conflict[];
}

/**
 * Answers "what happens if I move this" without committing. Pure — the drag
 * interaction calls this on every pointer move and throws the result away.
 */
export function whatIf(
  doc: TimelineDoc,
  change: Change,
  options: ConflictOptions = {},
): WhatIf {
  const next = applyChange(doc, change);
  const before = resolve(doc);
  const after = resolve(next);

  const startBefore = new Map(before.map((entry) => [entry.id, entry.startMin]));
  const movedIds = after
    .filter((entry) => startBefore.get(entry.id) !== entry.startMin)
    .map((entry) => entry.id);

  const existing = new Set(conflicts(before, doc, options).map(signature));
  const newConflicts = conflicts(after, next, options).filter(
    (conflict) => !existing.has(signature(conflict)),
  );

  return { before, after, doc: next, movedIds, newConflicts };
}

function signature(conflict: Conflict): string {
  return `${conflict.kind}:${[...conflict.blockIds].sort().join(",")}`;
}
