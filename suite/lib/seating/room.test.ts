import { beforeEach, expect, test } from "vitest";
import { newGuest, newTable } from "@/lib/model/factories";
import { emptySeating } from "@/lib/model/slices";
import type { Seating } from "@/lib/model/types";
import { seatGuest, type Plan } from "./actions";
import { buildContainers, computeSnap } from "./alignmentSnap";
import { getAdaptedSeatsForDrag, getTableGeometry } from "./geometry";
import {
  addSpace,
  recalibrate,
  removeSpace,
  restoreSnapshot,
  takeSnapshot,
} from "./roomActions";

let plan: Plan;

beforeEach(() => {
  plan = {
    guests: { g1: newGuest({ id: "g1", firstName: "Charis" }) },
    seating: {
      ...emptySeating(),
      tables: { t1: newTable({ id: "t1", label: "Table 1", x: 300, y: 300 }) },
    },
  };
});

// snapping ----------------------------------------------------------------

test("a dragged table snaps to a neighbour's centre line", () => {
  const result = computeSnap({
    moving: { cx: 203, cy: 400, hw: 50, hh: 50 },
    tables: [{ cx: 200, cy: 100, hw: 50, hh: 50 }],
    threshold: 8,
  });
  expect(result.x).toBe(200);
  expect(result.y).toBeNull();
  expect(result.guides.some((g) => g.kind === "line" && g.axis === "v")).toBe(true);
});

test("nothing within reach means nothing moves", () => {
  const result = computeSnap({
    moving: { cx: 500, cy: 500, hw: 50, hh: 50 },
    tables: [{ cx: 100, cy: 100, hw: 50, hh: 50 }],
    threshold: 8,
  });
  expect(result).toEqual({ x: null, y: null, guides: [] });
});

test("a table snaps flush to a wall and to the centre of the room", () => {
  const containers = [{ left: 0, top: 0, right: 1000, bottom: 800 }];
  expect(computeSnap({ moving: { cx: 52, cy: 400, hw: 50, hh: 50 }, containers }).x).toBe(50);
  expect(computeSnap({ moving: { cx: 497, cy: 400, hw: 50, hh: 50 }, containers }).x).toBe(500);
});

test("the room's spaces each become a wall rectangle", () => {
  const seating = addSpace(emptySeating(), "Marquee");
  const containers = buildContainers(seating.room);
  // The legacy room rect, plus the two spaces.
  expect(containers).toHaveLength(3);
});

// adaptive seats ----------------------------------------------------------

test("chairs move off an edge a neighbour has crowded", () => {
  const banquet = newTable({ id: "b1", type: "banquet", capacity: 16, x: 0, y: 0 });
  const geometry = getTableGeometry(banquet);

  // A neighbour pressed against the top edge.
  const adapted = getAdaptedSeatsForDrag(banquet, 0.7, [
    { cx: 0, cy: -geometry.height / 2 - 10, hw: geometry.width / 2, hh: 20 },
  ]);

  expect(adapted).not.toBeNull();
  const sides = (adapted!.patch as { perSideSeats: { top: number; bottom: number } }).perSideSeats;
  expect(sides.top).toBe(0);
  // Nobody is lost — the displaced eight went to the free edges.
  expect(adapted!.seats).toHaveLength(16);
});

test("an open table keeps the seating it was given", () => {
  expect(getAdaptedSeatsForDrag(plan.seating.tables["t1"]!, 0.7, [])).toBeNull();
});

test("a round table crowded on one side seats everyone on the free arc", () => {
  const round = newTable({ id: "r1", type: "round", capacity: 8, x: 0, y: 0 });
  const adapted = getAdaptedSeatsForDrag(round, 0.7, [{ cx: 0, cy: -70, hw: 60, hh: 20 }]);
  expect(adapted).not.toBeNull();
  expect(adapted!.seats).toHaveLength(8);
  // Every seat is now below the crowded edge.
  expect(adapted!.seats.every((s) => s.y > -70)).toBe(true);
});

// calibration -------------------------------------------------------------

test("recalibrating rescales the plan so the room looks unchanged", () => {
  const seating: Seating = {
    ...plan.seating,
    zones: {
      z1: { id: "z1", label: "Dance floor", x: 100, y: 100, width: 200, height: 200, colour: "#849E86" },
    },
  };

  const doubled = recalibrate(seating, 1.4);
  expect(doubled.settings.pixelsPerUnit).toBe(1.4);
  expect(doubled.tables["t1"]!.x).toBe(600);
  expect(doubled.zones["z1"]!.width).toBe(400);
  // The proportion of table to room is what was preserved.
  expect(doubled.room.width / doubled.tables["t1"]!.x).toBeCloseTo(
    seating.room.width / seating.tables["t1"]!.x,
  );
});

test("an impossible scale is refused rather than dividing the room by zero", () => {
  expect(recalibrate(plan.seating, 0)).toBe(plan.seating);
  expect(recalibrate(plan.seating, Number.NaN)).toBe(plan.seating);
});

// spaces ------------------------------------------------------------------

test("the last floor space cannot be deleted", () => {
  const one = emptySeating();
  expect(removeSpace(one, one.room.spaces[0]!.id).room.spaces).toHaveLength(1);
});

test("a new space is placed clear of the ones already there", () => {
  const seating = addSpace(emptySeating(), "Marquee");
  const [first, second] = seating.room.spaces;
  expect(second!.x).toBeGreaterThan(first!.x + (first as { width: number }).width);
});

// snapshots ---------------------------------------------------------------

test("a snapshot restores the plan it was taken from", () => {
  const seated = seatGuest(plan, "g1", "t1");
  const withSnap = { ...seated, seating: takeSnapshot(seated, "Before the shuffle") };

  // Now wreck it.
  const wrecked: Plan = {
    guests: { ...withSnap.guests, g1: { ...withSnap.guests["g1"]!, assignedTableId: null } },
    seating: { ...withSnap.seating, tables: {} },
  };

  const restored = restoreSnapshot(wrecked, withSnap.seating.snapshots[0]!.id)!;
  expect(restored.seating.tables["t1"]!.assignedGuestIds).toEqual(["g1"]);
  expect(restored.guests["g1"]!.assignedTableId).toBe("t1");
});

test("restoring keeps a snapshot of what was there first, so it is reversible", () => {
  const seating = takeSnapshot(plan, "One");
  const restored = restoreSnapshot({ ...plan, seating }, seating.snapshots[0]!.id)!;
  expect(restored.seating.snapshots.length).toBeGreaterThan(1);
  expect(restored.seating.snapshots[0]!.label).toContain("Before restoring");
});

test("a snapshot does not carry every earlier snapshot inside it", () => {
  let seating = takeSnapshot(plan, "One");
  seating = takeSnapshot({ ...plan, seating }, "Two");
  const inner = seating.snapshots[0]!.seating as Seating;
  expect(inner.snapshots).toEqual([]);
});

test("restoring a snapshot that is not there returns null rather than an empty plan", () => {
  expect(restoreSnapshot(plan, "nope")).toBeNull();
});

test("rescaling keeps the room's proportions, legacy tables included", () => {
  // A table with no real-world size is drawn at a fixed pixel preset. Before
  // this was fixed, rescaling moved everything except those tables, so the room
  // silently changed shape.
  const legacy = newTable({ id: "old", type: "round", capacity: 8, x: 300, y: 300 });
  expect(legacy.sizeUnits).toBeUndefined();

  const before = getTableGeometry(legacy, 0.7);
  const seating: Seating = { ...emptySeating(), tables: { old: legacy } };

  const doubled = recalibrate(seating, 1.4);
  const after = getTableGeometry(doubled.tables["old"]!, 1.4);

  expect(after.radius).toBeCloseTo(before.radius * 2, 1);
  // And the table still sits in the same place relative to the room.
  expect(doubled.tables["old"]!.x / doubled.room.width).toBeCloseTo(
    legacy.x / seating.room.width,
  );
});

test("a table already carrying a real size is not re-derived", () => {
  const sized = newTable({
    id: "t",
    x: 100,
    y: 100,
    sizeUnits: { shape: "circle", diameter: 150 },
  });
  const seating: Seating = { ...emptySeating(), tables: { t: sized } };
  expect(recalibrate(seating, 1.4).tables["t"]!.sizeUnits).toEqual({
    shape: "circle",
    diameter: 150,
  });
});
