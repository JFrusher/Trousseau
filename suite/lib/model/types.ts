/**
 * The entity shapes the suite reads and writes.
 *
 * These are the shapes the four standalone apps already use, transcribed to
 * TypeScript — Tableaux's guest and table, Cadence's block, Brigade's job.
 * They live here rather than in `@jfrusher/trousseau` on purpose: that package
 * validates the envelope and stops at the slice boundary, so that a change to
 * what a guest is does not need a release of the contract. See its
 * `src/slices.ts` for the reasoning.
 */

export type RsvpStatus = "confirmed" | "declined" | "pending";
export type Side = "bride" | "groom" | "both" | "";
export type SeatMode = "table" | "seat";

/** A person on the list. Lives in the `guests` slice, keyed by id. */
export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  rsvpStatus: RsvpStatus;
  dietary: string;
  /** The chosen main course, when the couple asked. Read by the place cards. */
  entree: string;
  notes: string;
  side: Side;
  groupId: string | null;
  subgroupId: string | null;
  familyId: string | null;
  /** The table this guest sits at, or null. Mirrors `Table.assignedGuestIds`. */
  assignedTableId: string | null;
  /** Free-text labels of the couple's own devising. Filterable, never enumerated. */
  tags: string[];
  /**
   * The guest this one is a plus-one of, or null.
   *
   * Recorded rather than derived because "Charis Smith + guest" arrives on the
   * RSVP as one row and becomes two people, and losing which of them was
   * invited loses why the second is there.
   */
  plusOneOf: string | null;
}

/** A pair of guests who must, or must not, share a table. */
export type ConstraintKind = "together" | "apart";

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  /** Exactly two. A rule about three people is three rules. */
  guestIds: [string, string];
  note: string;
}

/** Real-world footprint in centimetres. Absent on plans authored before units. */
export type SizeUnits =
  | { shape: "circle" | "half-circle"; diameter: number }
  | { shape: "rect"; width: number; height: number };

/** What a table is for, beyond its shape. Drives warnings and reports. */
export type Designation = "top-table" | "vip" | "kids" | "band-bar" | null;

export interface Table {
  id: string;
  label: string;
  type: string;
  capacity: number;
  /** Canvas pixels, centre of the table. */
  x: number;
  y: number;
  rotation: number;
  /** `seat` means the index in `assignedGuestIds` is the seat number. */
  seatMode: SeatMode;
  /** Ordered. For seat-mode tables the index is the seat. Holes are `null`. */
  assignedGuestIds: Array<string | null>;
  sizeUnits?: SizeUnits;
  /** Per-edge seat counts, once a drag has pushed chairs off a blocked side. */
  perSideSeats?: PerSideSeats | null;
  /** The arc a round table's seats are confined to, once neighbours crowd it. */
  seatArcRange?: { start: number; total: number } | null;
  designation: Designation;
  /** Overrides the type's colour on the canvas. */
  colour: string | null;
}

export interface PerSideSeats {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A named collection of guests — "Bride's family", "University". */
export interface NamedGroup {
  id: string;
  name: string;
  colour?: string;
}

/**
 * A family, which is a group that must not be split across tables.
 *
 * Membership is held here as well as on the guest because the split warning
 * asks "is this family together?", and answering it from the guest side means
 * scanning every guest for every family on every render.
 */
export interface Family extends NamedGroup {
  memberIds: string[];
}

/** A labelled area of floor — "Dance floor", "Bar". Not a table, not a wall. */
export interface Zone {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
}

/**
 * One floor space: a rectangle, or a polygon whose vertices are relative to
 * its origin. A wedding in a marquee plus a barn is two spaces, not one
 * bounding box with dead ground in the middle.
 */
export type Space =
  | {
      id: string;
      label: string;
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      backgroundColour: string;
    }
  | {
      id: string;
      label: string;
      shape: "polygon";
      x: number;
      y: number;
      vertices: Array<{ x: number; y: number }>;
      backgroundColour: string;
    };

/** A wall segment or a pillar — something a table cannot be put through. */
export interface Obstacle {
  id: string;
  kind: "wall" | "pillar";
  x: number;
  y: number;
  /** Walls use both; a pillar is drawn as an ellipse in the same box. */
  width: number;
  height: number;
  rotation: number;
}

export interface RoomSpec {
  widthUnits: number;
  heightUnits: number;
  width: number;
  height: number;
  backgroundColour: string;
  spaces: Space[];
}

export type UnitSystem = "metric" | "imperial";

export interface SeatingSettings {
  defaultSeatMode: SeatMode;
  /** Canvas pixels per centimetre. Locked per plan — see `slices.DEFAULT_PPU`. */
  pixelsPerUnit: number;
  gridSnap: boolean;
  gridSize: number;
  /** Snap a dragged table to the edges and centres of its neighbours. */
  snapAlign: boolean;
  showChairs: boolean;
  /** Diameter of a banquet chair, in centimetres. */
  chairSizeUnits: number;
  showDietaryBadges: boolean;
  showGroupColours: boolean;
  unitSystem: UnitSystem;
  customTablePresets: CustomTablePreset[];
}

/** A rectangle table with seat counts the user set per edge. */
export interface CustomTablePreset {
  id: string;
  label: string;
  widthUnits: number;
  heightUnits: number;
  perSideSeats: PerSideSeats;
}

/** A whole plan, kept so a rearrangement can be abandoned. */
export interface Snapshot {
  id: string;
  label: string;
  at: string;
  /** The `seating` and `guests` slices as they were. */
  seating: unknown;
  guests: unknown;
}

/**
 * The `seating` slice. Guests are deliberately not in here — they are their own
 * slice, because the place cards and the crew sheets need them and neither
 * cares where the tables are.
 */
export interface Seating {
  tables: Record<string, Table>;
  groups: Record<string, NamedGroup>;
  subgroups: Record<string, NamedGroup>;
  families: Record<string, Family>;
  zones: Record<string, Zone>;
  obstacles: Record<string, Obstacle>;
  constraints: Constraint[];
  snapshots: Snapshot[];
  room: RoomSpec;
  settings: SeatingSettings;
}

/** One piece of work on the day. The `crew` slice. Brigade's model. */
export interface Team {
  id: string;
  tag: string | null;
  name: string;
  phone: string;
  notes: string;
}

export interface Person {
  id: string;
  name: string;
  teamId: string | null;
  phone: string;
  notes: string;
}

export interface Job {
  id: string;
  /** The block of the day this hangs off. The only link to the timeline. */
  blockId: string;
  label: string;
  notes: string;
  teamId: string | null;
  personIds: string[];
  /** Kanban column. Derived work is not stored; this is the user's own mark. */
  status: JobStatus;
}

export const JOB_STATUSES = ["todo", "doing", "done"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Crew {
  teams: Team[];
  people: Person[];
  jobs: Job[];
}
