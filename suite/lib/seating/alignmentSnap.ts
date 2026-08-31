import type { RoomSpec } from "@/lib/model/types";

/**
 * Alignment snapping geometry.
 *
 * Ported from Tableaux's `client/src/utils/alignmentSnap.js`. Pure: the caller
 * feeds in plain boxes and gets back a snapped centre plus the guide lines to
 * draw, so none of this needs a canvas to be tested.
 *
 * All coordinates are canvas pixels. The dragged table and every other table
 * are a centre plus half-extents — the unrotated axis-aligned box from
 * `getTableGeometry`. Containers (walls: room spaces and the legacy room
 * rectangle) are left/top/right/bottom rectangles.
 *
 * Each axis is solved independently, so a table can centre-align on x while
 * edge-aligning on y. Within an axis every candidate centre is gathered —
 * alignment to other tables, centring or going flush to a wall, equal spacing —
 * and the one nearest the free position wins, if it is inside `threshold`.
 */

export interface SnapBox {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export interface Container {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Axis = "x" | "y";

export type Guide =
  | {
      kind: "line";
      axis: "h" | "v";
      pos: number;
      start: number;
      end: number;
      variant: "align" | "center" | "wall";
    }
  | {
      kind: "spacing";
      axis: Axis;
      perp: number;
      segments: Array<[number, number]>;
      dist: number;
    };

const loOf = (b: SnapBox, a: Axis) => (a === "x" ? b.cx - b.hw : b.cy - b.hh);
const hiOf = (b: SnapBox, a: Axis) => (a === "x" ? b.cx + b.hw : b.cy + b.hh);
const midOf = (b: SnapBox, a: Axis) => (a === "x" ? b.cx : b.cy);
const halfOf = (b: SnapBox, a: Axis) => (a === "x" ? b.hw : b.hh);
const cLoOf = (c: Container, a: Axis) => (a === "x" ? c.left : c.top);
const cHiOf = (c: Container, a: Axis) => (a === "x" ? c.right : c.bottom);

/** Do two boxes overlap on the axis perpendicular to `axis` — same row or column? */
function perpOverlap(a: SnapBox, b: SnapBox, axis: Axis): boolean {
  const other: Axis = axis === "x" ? "y" : "x";
  return loOf(a, other) < hiOf(b, other) && loOf(b, other) < hiOf(a, other);
}

interface SnapRef {
  type: "align" | "center" | "wall" | "spacing";
  axis: Axis;
  pos?: number;
  others?: SnapBox[];
  container?: Container;
  perp?: number;
  segments?: Array<[number, number]>;
  dist?: number;
}

/** Equal-spacing (distribution) candidates for one axis. */
function spacingCandidates(
  axis: Axis,
  moving: SnapBox,
  tables: SnapBox[],
  half: number,
): Array<{ coord: number; ref: SnapRef }> {
  const out: Array<{ coord: number; ref: SnapRef }> = [];
  const neigh = tables.filter((t) => perpOverlap(moving, t, axis));
  if (neigh.length === 0) return out;

  const cur = midOf(moving, axis);
  const left = neigh
    .filter((t) => hiOf(t, axis) <= cur)
    .sort((a, b) => midOf(b, axis) - midOf(a, axis));
  const right = neigh
    .filter((t) => loOf(t, axis) >= cur)
    .sort((a, b) => midOf(a, axis) - midOf(b, axis));

  const ref = (segments: Array<[number, number]>, gap: number): SnapRef => ({
    type: "spacing",
    axis,
    perp: axis === "x" ? moving.cy : moving.cx,
    segments,
    dist: gap,
  });

  // Centred between one neighbour on each side: equal gap left and right.
  const l0 = left[0];
  const r0 = right[0];
  if (l0 && r0) {
    const avail = loOf(r0, axis) - hiOf(l0, axis) - 2 * half;
    if (avail > 0) {
      const gap = avail / 2;
      const coord = hiOf(l0, axis) + gap + half;
      out.push({
        coord,
        ref: ref(
          [
            [hiOf(l0, axis), hiOf(l0, axis) + gap],
            [coord + half, coord + half + gap],
          ],
          gap,
        ),
      });
    }
  }

  // Match the adjacent gap on the right — needs two stationary neighbours there.
  const r1 = right[1];
  if (r0 && r1) {
    const gap = loOf(r1, axis) - hiOf(r0, axis);
    if (gap > 0) {
      const coord = loOf(r0, axis) - gap - half;
      out.push({
        coord,
        ref: ref(
          [
            [coord + half, coord + half + gap],
            [hiOf(r0, axis), hiOf(r0, axis) + gap],
          ],
          gap,
        ),
      });
    }
  }

  // And the same on the left.
  const l1 = left[1];
  if (l0 && l1) {
    const gap = loOf(l0, axis) - hiOf(l1, axis);
    if (gap > 0) {
      const coord = hiOf(l0, axis) + gap + half;
      out.push({
        coord,
        ref: ref(
          [
            [hiOf(l1, axis), hiOf(l1, axis) + gap],
            [hiOf(l0, axis), hiOf(l0, axis) + gap],
          ],
          gap,
        ),
      });
    }
  }

  return out;
}

function solveAxis(
  axis: Axis,
  moving: SnapBox,
  tables: SnapBox[],
  containers: Container[],
  threshold: number,
): { coord: number | null; ref: SnapRef | null } {
  const half = halfOf(moving, axis);
  const cur = midOf(moving, axis);
  const cands: Array<{ coord: number; delta: number; ref: SnapRef }> = [];

  const push = (coord: number, pos: number, ref: SnapRef) => {
    const delta = Math.abs(coord - cur);
    if (delta <= threshold) cands.push({ coord, delta, ref: { ...ref, pos } });
  };

  for (const t of tables) {
    const tlo = loOf(t, axis);
    const tmid = midOf(t, axis);
    const thi = hiOf(t, axis);
    const ref: SnapRef = { type: "align", axis, others: [t] };
    push(tmid, tmid, ref); // centre to centre
    push(tlo + half, tlo, ref); // near edge to near edge
    push(thi - half, thi, ref); // far edge to far edge
    push(thi + half, thi, ref); // flush after
    push(tlo - half, tlo, ref); // flush before
  }

  for (const c of containers) {
    const clo = cLoOf(c, axis);
    const chi = cHiOf(c, axis);
    push((clo + chi) / 2, (clo + chi) / 2, { type: "center", axis, container: c });
    push(clo + half, clo, { type: "wall", axis, container: c });
    push(chi - half, chi, { type: "wall", axis, container: c });
  }

  for (const sp of spacingCandidates(axis, moving, tables, half)) {
    const delta = Math.abs(sp.coord - cur);
    if (delta <= threshold) cands.push({ coord: sp.coord, delta, ref: sp.ref });
  }

  const best = cands.sort((a, b) => a.delta - b.delta)[0];
  return best ? { coord: best.coord, ref: best.ref } : { coord: null, ref: null };
}

/** Turn a chosen snap reference into renderable guides, given the final box. */
function buildGuides(ref: SnapRef, moving: SnapBox): Guide[] {
  if (ref.type === "spacing") {
    return [
      {
        kind: "spacing",
        axis: ref.axis,
        perp: ref.perp ?? 0,
        segments: ref.segments ?? [],
        dist: ref.dist ?? 0,
      },
    ];
  }

  const variant = ref.type as "align" | "center" | "wall";
  const pos = ref.pos ?? 0;

  if (ref.axis === "x") {
    let lo = moving.cy - moving.hh;
    let hi = moving.cy + moving.hh;
    if (ref.container) {
      lo = ref.container.top;
      hi = ref.container.bottom;
    } else {
      for (const o of ref.others ?? []) {
        lo = Math.min(lo, o.cy - o.hh);
        hi = Math.max(hi, o.cy + o.hh);
      }
    }
    return [{ kind: "line", axis: "v", pos, start: lo, end: hi, variant }];
  }

  let lo = moving.cx - moving.hw;
  let hi = moving.cx + moving.hw;
  if (ref.container) {
    lo = ref.container.left;
    hi = ref.container.right;
  } else {
    for (const o of ref.others ?? []) {
      lo = Math.min(lo, o.cx - o.hw);
      hi = Math.max(hi, o.cx + o.hw);
    }
  }
  return [{ kind: "line", axis: "h", pos, start: lo, end: hi, variant }];
}

export interface SnapResult {
  /** The snapped centre on each axis, or null where that axis did not snap. */
  x: number | null;
  y: number | null;
  guides: Guide[];
}

export function computeSnap({
  moving,
  tables = [],
  containers = [],
  threshold = 8,
}: {
  moving: SnapBox;
  tables?: SnapBox[];
  containers?: Container[];
  threshold?: number;
}): SnapResult {
  const xr = solveAxis("x", moving, tables, containers, threshold);
  const yr = solveAxis("y", moving, tables, containers, threshold);

  const final: SnapBox = {
    cx: xr.coord ?? moving.cx,
    cy: yr.coord ?? moving.cy,
    hw: moving.hw,
    hh: moving.hh,
  };

  const guides: Guide[] = [];
  if (xr.ref) guides.push(...buildGuides(xr.ref, final));
  if (yr.ref) guides.push(...buildGuides(yr.ref, final));
  return { x: xr.coord, y: yr.coord, guides };
}

/** Axis-aligned wall rectangles from the room model — every space, plus the legacy rect. */
export function buildContainers(room: RoomSpec | undefined): Container[] {
  const out: Container[] = [];
  if (!room) return out;
  if (room.width && room.height) {
    out.push({ left: 0, top: 0, right: room.width, bottom: room.height });
  }
  for (const sp of room.spaces ?? []) {
    if (sp.shape === "polygon") {
      if (sp.vertices.length === 0) continue;
      const xs = sp.vertices.map((v) => sp.x + v.x);
      const ys = sp.vertices.map((v) => sp.y + v.y);
      out.push({
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      });
    } else {
      out.push({ left: sp.x, top: sp.y, right: sp.x + sp.width, bottom: sp.y + sp.height });
    }
  }
  return out;
}
