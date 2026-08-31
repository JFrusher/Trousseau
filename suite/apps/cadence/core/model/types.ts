/** The Cadence document model. See PRD §3. */

/** A printed piece. Which blocks reach it is per block, in `Block.outputs`. */
export type OutputId = "run-sheet" | "call-sheet" | "order-of-day" | "contact-sheet";

export const OUTPUT_IDS: readonly OutputId[] = [
  "run-sheet",
  "call-sheet",
  "order-of-day",
  "contact-sheet",
];

export interface Block {
  id: string;
  label: string;
  /** Zero is a moment: a point on the clock rather than a stretch of it. */
  durationMin: number;
  /** Anchored: pinned to a clock time. Floating (null): starts after its predecessor. */
  anchorMin: number | null;
  /** Minutes of gap after the predecessor. Floating blocks only. */
  gapMin: number;
  /** Contingency padding after the block's own duration. */
  bufferMin: number;
  /**
   * The shortest this block may run when the day has to be squeezed. Null or
   * absent: it never shrinks. When a floating chain grows into a downstream
   * anchor, the resolver takes the overrun out of the squeezable blocks in
   * that stretch rather than reporting a clash — see core/schedule/resolve.
   */
  squeezeToMin?: number | null;
  lane: string;
  tags: string[];
  location: string;
  notes: string;
  /** Which printed pieces this block appears on. */
  outputs: OutputId[];
}

/** Optional detail hung off a free-text tag. No entity management, no CRUD. */
/**
 * A moment is a block with no length — the rings handed over, the cake cut,
 * the coach pulling away. It takes no time from its lane, so it can sit inside
 * something already running without anything having to move to fit it in.
 */
export function isMoment(block: Pick<Block, "durationMin">): boolean {
  return block.durationMin <= 0;
}

export interface TagDetail {
  tag: string;
  displayName?: string;
  phone?: string;
  arrivalMin?: number | null;
  notes?: string;
}

export interface DaySettings {
  /** ISO `YYYY-MM-DD`. Used for display and the solar calculation only. */
  date: string;
  coupleNames: string;
  venueName: string;
  latitude: number;
  longitude: number;
  /** The day's offset from UTC in minutes. BST is 60. Entered, never inferred. */
  utcOffsetMin: number;
  /** Minutes-from-00:00. May exceed 1440. */
  curfewMin: number;
  /** Blob store key for the logo, or null. */
  logoKey: string | null;
}

export interface StyleSpec {
  fontFamily: string;
  /** Multiplier on the piece's base type size. */
  typeScale: number;
  ruleWeightPt: number;
  accentHex: string;
  showLogo: boolean;
}

/** A font the user uploaded. Bytes live in the blob store, keyed by `blobKey`. */
export interface UploadedFont {
  family: string;
  blobKey: string;
}

export interface OutputSpec {
  id: OutputId;
  label: string;
  pageSize: "A4" | "A5";
}

export interface TimelineDoc {
  schemaVersion: number;
  appVersion: string;
  day: DaySettings;
  /** Lane names in display order. Every block's `lane` is one of these. */
  lanes: string[];
  blocks: Block[];
  tagDetails: TagDetail[];
  outputs: OutputSpec[];
  styles: Record<OutputId, StyleSpec>;
  fonts: UploadedFont[];
}
