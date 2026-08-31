import type { TimelineDoc } from "../model/types";
import { byLane, type ResolvedBlock } from "./resolve";

export interface SlackReport {
  /**
   * Minutes between the end of a block's segment and the next anchor downstream
   * in its lane. Null when nothing downstream is anchored. Negative is an
   * overrun. Every block in a segment shares the figure — it is the segment's
   * headroom, and any block growing eats it.
   */
  byBlock: Map<string, number | null>;
  /** Minutes left before curfew across the whole day. Negative is an overrun. */
  toCurfewMin: number;
  /** The latest end across every lane. */
  dayEndMin: number;
}

export function slack(resolved: ResolvedBlock[], doc: TimelineDoc): SlackReport {
  const byBlock = new Map<string, number | null>();

  for (const entries of byLane(resolved).values()) {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      let headroom: number | null = null;
      for (let k = i + 1; k < entries.length; k += 1) {
        const candidate = entries[k];
        const previous = entries[k - 1];
        if (!candidate?.anchored || !previous) continue;
        headroom = candidate.startMin - previous.endMin;
        break;
      }
      byBlock.set(entry.id, headroom);
    }
  }

  const dayEndMin = resolved.reduce((latest, entry) => Math.max(latest, entry.endMin), 0);

  return { byBlock, toCurfewMin: doc.day.curfewMin - dayEndMin, dayEndMin };
}
