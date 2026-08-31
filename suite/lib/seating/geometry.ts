import { getTableType, type TableTypeDef } from "./tableTypes";
import type { PerSideSeats, Table } from "@/lib/model/types";

/**
 * Table geometry and seat placement.
 *
 * Ported from Tableaux's `client/src/utils/seatPositions.js`. Returns, for a
 * given table, the bounding box of its shape (canvas px, centred on x/y) and
 * the position of every seat relative to that centre.
 *
 *   circle      → seats evenly around the circumference
 *   half-circle → seats fanned along the curved (top) edge
 *   rect        → seats distributed along the configured edges
 *
 * Seat order matches `assignedGuestIds` indices for seat-level tables, which is
 * why the emitters below run top → bottom → left → right and never vary.
 *
 * Footprint sizing has two modes:
 *   - Legacy (no `sizeUnits`): size derived from the type preset plus capacity,
 *     keeping plans authored before real units pixel-identical.
 *   - Real units (`sizeUnits`, in cm): size = cm × pixelsPerUnit, clamped up to
 *     the minimum that fits the seats so they never overlap.
 *
 * Rotation is deliberately not applied here: it is a presentational transform
 * on the table node, so local seat coordinates stay rotation-free.
 */

/** Spacing between seat centres along an edge. */
const SEAT_PITCH = 30;
/** Distance from the table edge to a seat centre. */
export const SEAT_OFFSET = 19;
export const SEAT_RADIUS = 14;

export interface Seat {
  x: number;
  y: number;
}

export interface TableGeometry {
  shape: "circle" | "rect" | "half-circle";
  width: number;
  height: number;
  radius: number;
  /** Half-circle only: the centre offset its flat edge sits at. */
  cy?: number;
  rounded?: boolean;
  seats: Seat[];
}

/** Split a capacity across rectangle edges according to the preset's layout. */
function sidesFromLayout(cap: number, def: TableTypeDef): PerSideSeats {
  const layout = def.seatLayout;
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;

  if (layout === "one-side") {
    bottom = cap;
  } else if (layout === "long-sides") {
    top = Math.ceil(cap / 2);
    bottom = Math.floor(cap / 2);
  } else {
    // perimeter — one seat on each short end when there is room for it
    const ends = cap >= 6 ? 2 : 0;
    left = ends ? 1 : 0;
    right = ends ? 1 : 0;
    const rem = cap - ends;
    top = Math.ceil(rem / 2);
    bottom = Math.floor(rem / 2);
  }
  return { top, bottom, left, right };
}

function minRectSize(sides: PerSideSeats, def: TableTypeDef): { width: number; height: number } {
  const perLong = Math.max(sides.top, sides.bottom, 1);
  const perShort = Math.max(sides.left, sides.right, 0);
  return {
    width: Math.max(def.width ?? 0, perLong * SEAT_PITCH + 24),
    height: Math.max(def.height ?? 0, perShort * SEAT_PITCH + 24),
  };
}

const minRoundRadius = (cap: number, def: TableTypeDef): number =>
  Math.max(def.baseRadius ?? 0, (cap * SEAT_PITCH) / (2 * Math.PI));

const minHalfRadius = (cap: number, def: TableTypeDef): number =>
  Math.max(def.baseRadius ?? 0, (cap * SEAT_PITCH) / Math.PI);

/**
 * When a table carries explicit `sizeUnits` the only hard floor is "seats must
 * not overlap" — the preset's cosmetic size is not a floor, so a table can be
 * shrunk right down to its seating. A small absolute floor keeps seatless or
 * tiny tables visible and clickable.
 */
const SEAT_FIT_FLOOR = 16;

const seatFitRadius = (cap: number): number =>
  Math.max(SEAT_FIT_FLOOR, (cap * SEAT_PITCH) / (2 * Math.PI));

const seatFitHalfRadius = (cap: number): number =>
  Math.max(SEAT_FIT_FLOOR, (cap * SEAT_PITCH) / Math.PI);

function seatFitRect(sides: PerSideSeats): { width: number; height: number } {
  const perLong = Math.max(sides.top, sides.bottom, 1);
  const perShort = Math.max(sides.left, sides.right, 0);
  return {
    width: Math.max(SEAT_FIT_FLOOR, perLong * SEAT_PITCH + 24),
    height: Math.max(SEAT_FIT_FLOOR, perShort * SEAT_PITCH + 24),
  };
}

/**
 * Seats around a circle. With `startAngle`/`arcTotal` they are distributed
 * across that arc instead, half-step centred so they stay evenly spaced within
 * it; the defaults reproduce the full-circle behaviour exactly.
 */
function roundSeatsAt(cap: number, radius: number, startAngle?: number, arcTotal?: number): Seat[] {
  const start = startAngle ?? -Math.PI / 2;
  const arc = arcTotal ?? 2 * Math.PI;
  const partial = arcTotal != null;
  const seatR = radius + SEAT_OFFSET;
  const seats: Seat[] = [];
  for (let i = 0; i < cap; i++) {
    const angle = partial ? start + (i + 0.5) * (arc / cap) : start + (i * arc) / cap;
    seats.push({ x: Math.cos(angle) * seatR, y: Math.sin(angle) * seatR });
  }
  return seats;
}

function halfCircleSeatsAt(cap: number, radius: number, cy: number): Seat[] {
  const seatR = radius + SEAT_OFFSET;
  const seats: Seat[] = [];
  for (let i = 0; i < cap; i++) {
    const t = (i + 0.5) / cap;
    const angle = Math.PI - t * Math.PI; // π (left) → 0 (right) across the top
    seats.push({ x: Math.cos(angle) * seatR, y: cy - Math.sin(angle) * seatR });
  }
  return seats;
}

/** Seats on the edges of a rect, in the order top → bottom → left → right. */
export function rectSeatsFromSides(
  sides: Partial<PerSideSeats> | null | undefined,
  width: number,
  height: number,
): Seat[] {
  const { top = 0, bottom = 0, left = 0, right = 0 } = sides ?? {};
  const seats: Seat[] = [];

  const row = (n: number, edge: "top" | "bottom" | "left" | "right") => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (edge === "top") seats.push({ x: -width / 2 + t * width, y: -height / 2 - SEAT_OFFSET });
      else if (edge === "bottom")
        seats.push({ x: -width / 2 + t * width, y: height / 2 + SEAT_OFFSET });
      else if (edge === "left")
        seats.push({ x: -width / 2 - SEAT_OFFSET, y: -height / 2 + t * height });
      else seats.push({ x: width / 2 + SEAT_OFFSET, y: -height / 2 + t * height });
    }
  };

  row(top, "top");
  row(bottom, "bottom");
  row(left, "left");
  row(right, "right");
  return seats;
}

export const DEFAULT_PPU = 0.7;

export function getTableGeometry(table: Table, pixelsPerUnit = DEFAULT_PPU): TableGeometry {
  const def = getTableType(table.type);
  const cap = Math.max(1, table.capacity || def.defaultCapacity);
  const su = table.sizeUnits;
  const shape = su?.shape ?? def.shape;
  const ppu = pixelsPerUnit || DEFAULT_PPU;

  if (shape === "circle") {
    const noSeats = def.seatLayout === "none";
    const minR = noSeats ? (def.baseRadius ?? SEAT_FIT_FLOOR) : minRoundRadius(cap, def);
    const seatFloor = noSeats ? SEAT_FIT_FLOOR : seatFitRadius(cap);
    const radius =
      su && su.shape !== "rect" ? Math.max((su.diameter * ppu) / 2, seatFloor) : minR;
    const arc = table.seatArcRange ?? null;
    return {
      shape: "circle",
      width: radius * 2,
      height: radius * 2,
      radius,
      seats: noSeats ? [] : roundSeatsAt(cap, radius, arc?.start, arc?.total),
    };
  }

  if (shape === "half-circle") {
    const minR = minHalfRadius(cap, def);
    const radius =
      su && su.shape !== "rect" ? Math.max((su.diameter * ppu) / 2, seatFitHalfRadius(cap)) : minR;
    const cy = radius / 2;
    return {
      shape: "half-circle",
      width: radius * 2,
      height: radius,
      radius,
      cy,
      seats: halfCircleSeatsAt(cap, radius, cy),
    };
  }

  const sides = table.perSideSeats ?? sidesFromLayout(cap, def);
  const min = minRectSize(sides, def);
  const fit = seatFitRect(sides);
  const width = su && su.shape === "rect" ? Math.max(su.width * ppu, fit.width) : min.width;
  const height = su && su.shape === "rect" ? Math.max(su.height * ppu, fit.height) : min.height;

  return {
    shape: "rect",
    width,
    height,
    rounded: def.rounded === true,
    radius: 0,
    seats: rectSeatsFromSides(sides, width, height),
  };
}

/** Fill-level colour for the capacity ring: sage → gold → rose. */
export function fillColour(ratio: number): string {
  if (ratio > 1) return "var(--color-rose)";
  if (ratio >= 0.85) return "var(--color-gold)";
  return "var(--color-sage)";
}

/**
 * Real-world size, in centimetres, from a table's current geometry.
 *
 * A plan authored before real units has tables sized by their type preset in
 * raw pixels, which do not move when the scale changes. Deriving `sizeUnits`
 * from what they measure now means the next render is pixel-identical and every
 * later rescale moves them with everything else.
 */
export function deriveSizeUnits(table: Table, pixelsPerUnit = DEFAULT_PPU): Table["sizeUnits"] {
  const ppu = pixelsPerUnit || DEFAULT_PPU;
  const bare: Table = { ...table, perSideSeats: null };
  delete bare.sizeUnits;
  const g = getTableGeometry(bare, ppu);
  const round = (n: number) => Math.round((n / ppu) * 100) / 100;

  if (g.shape === "circle" || g.shape === "half-circle") {
    return { shape: g.shape, diameter: round(g.radius * 2) };
  }
  return { shape: "rect", width: round(g.width), height: round(g.height) };
}

// adaptive seats ---------------------------------------------------------------

/** Gap between a table edge and a neighbour that pushes the chairs elsewhere. */
const CHAIR_BUFFER = SEAT_OFFSET * 2 + 8;

/** A neighbour, as the drag layer describes it: centre plus half-extents. */
export interface NeighbourBox {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export interface AdaptedSeats {
  seats: Seat[];
  /** The table fields to commit on drop. */
  patch: Pick<Table, "perSideSeats"> | Pick<Table, "seatArcRange">;
}

/**
 * Move chairs off any edge a neighbour has crowded.
 *
 * Two banquet tables pushed together should not have a row of chairs between
 * them; the people on that side move round to a free edge. Returns null when
 * nothing is crowded, so the caller can keep the table's own seating.
 */
export function getAdaptedSeatsForDrag(
  table: Table,
  pixelsPerUnit: number,
  neighbours: NeighbourBox[],
): AdaptedSeats | null {
  if (neighbours.length === 0) return null;
  const geometry = getTableGeometry(table, pixelsPerUnit || DEFAULT_PPU);
  if (geometry.shape === "rect") return adaptRect(table, geometry, neighbours);
  if (geometry.shape === "circle") return adaptCircle(table, geometry, neighbours);
  return null;
}

function adaptRect(
  table: Table,
  geometry: TableGeometry,
  neighbours: NeighbourBox[],
): AdaptedSeats | null {
  const ax = table.x;
  const ay = table.y;
  const aw = geometry.width / 2;
  const ah = geometry.height / 2;
  const blocked = { top: false, bottom: false, left: false, right: false };

  for (const n of neighbours) {
    // `<=` and `>=` so exactly-touching edges count as overlapping. Direction is
    // decided by comparing centres, which is why the gap needs no sign check:
    // an already-adjacent neighbour still registers as blocking.
    const xOverlap = ax - aw <= n.cx + n.hw && ax + aw >= n.cx - n.hw;
    const yOverlap = ay - ah <= n.cy + n.hh && ay + ah >= n.cy - n.hh;

    if (xOverlap) {
      if (n.cy < ay && ay - ah - (n.cy + n.hh) < CHAIR_BUFFER) blocked.top = true;
      if (n.cy > ay && n.cy - n.hh - (ay + ah) < CHAIR_BUFFER) blocked.bottom = true;
    }
    if (yOverlap) {
      if (n.cx < ax && ax - aw - (n.cx + n.hw) < CHAIR_BUFFER) blocked.left = true;
      if (n.cx > ax && n.cx - n.hw - (ax + aw) < CHAIR_BUFFER) blocked.right = true;
    }
  }

  if (!blocked.top && !blocked.bottom && !blocked.left && !blocked.right) return null;

  const def = getTableType(table.type);
  const cap = Math.max(1, table.capacity || def.defaultCapacity);
  const adapted: PerSideSeats = { ...(table.perSideSeats ?? sidesFromLayout(cap, def)) };
  const free: Array<keyof PerSideSeats> = [];
  let displaced = 0;

  for (const side of ["top", "bottom", "left", "right"] as const) {
    if (blocked[side]) {
      displaced += adapted[side];
      adapted[side] = 0;
    } else {
      free.push(side);
    }
  }

  // Every edge crowded, or nobody to move: leave the table as the user set it
  // rather than inventing a seating nobody asked for.
  if (free.length === 0 || displaced === 0) return null;

  for (let i = 0; i < displaced; i++) {
    adapted[free[i % free.length]!] += 1;
  }

  return {
    seats: rectSeatsFromSides(adapted, geometry.width, geometry.height),
    patch: { perSideSeats: adapted },
  };
}

function adaptCircle(
  table: Table,
  geometry: TableGeometry,
  neighbours: NeighbourBox[],
): AdaptedSeats | null {
  const ax = table.x;
  const ay = table.y;
  const r = geometry.radius;
  const cap = Math.max(1, table.capacity || 0);
  const TAU = 2 * Math.PI;
  const blocks: Array<{ centre: number; half: number }> = [];

  for (const n of neighbours) {
    const dx = n.cx - ax;
    const dy = n.cy - ay;
    const dist = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);
    const toward = theta + Math.PI;
    const bHalf = n.hw * Math.abs(Math.cos(toward)) + n.hh * Math.abs(Math.sin(toward));

    if (dist - r - bHalf < CHAIR_BUFFER) {
      const perpHalf = n.hw * Math.abs(Math.sin(theta)) + n.hh * Math.abs(Math.cos(theta));
      blocks.push({
        centre: theta,
        half: Math.atan2(perpHalf + SEAT_OFFSET + SEAT_RADIUS, Math.max(dist - r, 1)),
      });
    }
  }

  if (blocks.length === 0) return null;

  // Each blocked arc becomes an interval in [0, TAU). One crossing the 0/TAU
  // boundary is split in two so a plain interval merge works on all of them.
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const intervals: Array<[number, number]> = [];
  for (const { centre, half } of blocks) {
    const lo = norm(centre - half);
    const hi = norm(centre + half);
    if (lo <= hi) intervals.push([lo, hi]);
    else {
      intervals.push([lo, TAU]);
      intervals.push([0, hi]);
    }
  }

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of intervals) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }

  // The widest free arc between consecutive blocked ones. The last gap wraps
  // round to the first interval's start.
  let bestStart = 0;
  let bestTotal = 0;
  for (let i = 0; i < merged.length; i++) {
    const gapStart = merged[i]![1];
    const gapEnd = i + 1 < merged.length ? merged[i + 1]![0] : merged[0]![0] + TAU;
    if (gapEnd - gapStart > bestTotal) {
      bestTotal = gapEnd - gapStart;
      bestStart = gapStart;
    }
  }

  if (bestTotal <= 0) return null;

  return {
    seats: roundSeatsAt(cap, r, bestStart, bestTotal),
    patch: { seatArcRange: { start: bestStart, total: bestTotal } },
  };
}
