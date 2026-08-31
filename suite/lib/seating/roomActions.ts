import { newId } from "@/lib/model/ids";
import { coerceGuests } from "@/lib/model/slices";
import { deriveSizeUnits } from "./geometry";
import type {
  CustomTablePreset,
  Obstacle,
  PerSideSeats,
  Seating,
  Snapshot,
  Space,
  Zone,
} from "@/lib/model/types";
import type { Plan } from "./actions";

/**
 * The room itself: its floor spaces, its labelled areas, the things in the way,
 * the scale it is drawn at, and the versions of it worth keeping.
 */

// zones -------------------------------------------------------------------

export function addZone(seating: Seating, label: string, at: { x: number; y: number }): Seating {
  const zone: Zone = {
    id: newId("zone"),
    label: label.trim() || "Zone",
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: 240,
    height: 160,
    colour: "#849E86",
  };
  return { ...seating, zones: { ...seating.zones, [zone.id]: zone } };
}

export function patchZone(seating: Seating, id: string, patch: Partial<Zone>): Seating {
  const zone = seating.zones[id];
  if (!zone) return seating;
  return { ...seating, zones: { ...seating.zones, [id]: { ...zone, ...patch } } };
}

export function removeZone(seating: Seating, id: string): Seating {
  const zones = { ...seating.zones };
  delete zones[id];
  return { ...seating, zones };
}

// walls and pillars -------------------------------------------------------

export function addObstacle(
  seating: Seating,
  kind: Obstacle["kind"],
  at: { x: number; y: number },
): Seating {
  const obstacle: Obstacle = {
    id: newId("obs"),
    kind,
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: kind === "wall" ? 240 : 40,
    height: kind === "wall" ? 12 : 40,
    rotation: 0,
  };
  return { ...seating, obstacles: { ...seating.obstacles, [obstacle.id]: obstacle } };
}

export function patchObstacle(seating: Seating, id: string, patch: Partial<Obstacle>): Seating {
  const obstacle = seating.obstacles[id];
  if (!obstacle) return seating;
  return { ...seating, obstacles: { ...seating.obstacles, [id]: { ...obstacle, ...patch } } };
}

export function removeObstacle(seating: Seating, id: string): Seating {
  const obstacles = { ...seating.obstacles };
  delete obstacles[id];
  return { ...seating, obstacles };
}

// floor spaces ------------------------------------------------------------

export function addSpace(seating: Seating, label: string): Seating {
  // Placed clear to the right of everything already there, so a new marquee
  // does not land on top of the barn.
  const right = seating.room.spaces.reduce(
    (max, sp) => Math.max(max, sp.x + (sp.shape === "rect" ? sp.width : 0)),
    0,
  );
  const space: Space = {
    id: newId("space"),
    label: label.trim() || "Space",
    shape: "rect",
    x: right + 80,
    y: 0,
    width: 600,
    height: 450,
    backgroundColour: seating.room.backgroundColour,
  };
  return { ...seating, room: { ...seating.room, spaces: [...seating.room.spaces, space] } };
}

export function patchSpace(seating: Seating, id: string, patch: Partial<Space>): Seating {
  return {
    ...seating,
    room: {
      ...seating.room,
      spaces: seating.room.spaces.map((sp) =>
        sp.id === id ? ({ ...sp, ...patch } as Space) : sp,
      ),
    },
  };
}

/** The last space cannot go: tables need floor to stand on. */
export function removeSpace(seating: Seating, id: string): Seating {
  if (seating.room.spaces.length <= 1) return seating;
  return {
    ...seating,
    room: { ...seating.room, spaces: seating.room.spaces.filter((sp) => sp.id !== id) },
  };
}

// calibration -------------------------------------------------------------

/**
 * Change the scale the room is drawn at.
 *
 * Everything stored is canvas pixels, so changing pixels-per-centimetre would
 * silently resize every table and move every one of them relative to the walls.
 * Instead the whole plan is rescaled by the ratio, which leaves the room exactly
 * as it looks and only changes what the ruler says about it.
 */
export function recalibrate(seating: Seating, pixelsPerUnit: number): Seating {
  const from = seating.settings.pixelsPerUnit || 0.7;
  const to = pixelsPerUnit;
  if (!Number.isFinite(to) || to <= 0 || to === from) return seating;
  const k = to / from;

  const tables = Object.fromEntries(
    Object.entries(seating.tables).map(([id, t]) => [
      id,
      {
        ...t,
        x: t.x * k,
        y: t.y * k,
        // A table with no real-world size is drawn at a fixed pixel preset that
        // does not follow the scale. Pinning its current measurement first is
        // what keeps the room's proportions when everything else is rescaled.
        sizeUnits: t.sizeUnits ?? deriveSizeUnits(t, from),
      },
    ]),
  );
  const zones = Object.fromEntries(
    Object.entries(seating.zones).map(([id, z]) => [
      id,
      { ...z, x: z.x * k, y: z.y * k, width: z.width * k, height: z.height * k },
    ]),
  );
  const obstacles = Object.fromEntries(
    Object.entries(seating.obstacles).map(([id, o]) => [
      id,
      { ...o, x: o.x * k, y: o.y * k, width: o.width * k, height: o.height * k },
    ]),
  );

  return {
    ...seating,
    tables,
    zones,
    obstacles,
    room: {
      ...seating.room,
      width: seating.room.width * k,
      height: seating.room.height * k,
      spaces: seating.room.spaces.map((sp) =>
        sp.shape === "rect"
          ? { ...sp, x: sp.x * k, y: sp.y * k, width: sp.width * k, height: sp.height * k }
          : {
              ...sp,
              x: sp.x * k,
              y: sp.y * k,
              vertices: sp.vertices.map((v) => ({ x: v.x * k, y: v.y * k })),
            },
      ),
    },
    settings: { ...seating.settings, pixelsPerUnit: to },
  };
}

// custom table presets ----------------------------------------------------

export function addCustomPreset(
  seating: Seating,
  preset: Omit<CustomTablePreset, "id">,
): Seating {
  const entry: CustomTablePreset = { ...preset, id: newId("preset") };
  return {
    ...seating,
    settings: {
      ...seating.settings,
      customTablePresets: [...seating.settings.customTablePresets, entry],
    },
  };
}

export function removeCustomPreset(seating: Seating, id: string): Seating {
  return {
    ...seating,
    settings: {
      ...seating.settings,
      customTablePresets: seating.settings.customTablePresets.filter((p) => p.id !== id),
    },
  };
}

export const seatsInPreset = (sides: PerSideSeats): number =>
  sides.top + sides.bottom + sides.left + sides.right;

// snapshots ---------------------------------------------------------------

/** How many kept plans is useful before the list itself becomes the problem. */
const SNAPSHOT_LIMIT = 20;

/**
 * Keep the plan as it stands, so a rearrangement can be abandoned.
 *
 * Distinct from undo: undo is for the last few minutes, a snapshot is for "this
 * was the version before I moved everyone around on Tuesday". The guests are
 * stored with the seating because who sits where lives on both.
 */
export function takeSnapshot(plan: Plan, label: string): Seating {
  const snapshot: Snapshot = {
    id: newId("snap"),
    label: label.trim() || new Date().toLocaleString(),
    at: new Date().toISOString(),
    // Without the snapshot list itself, or each one would carry every earlier one.
    seating: { ...plan.seating, snapshots: [] },
    guests: plan.guests,
  };
  const kept = [snapshot, ...plan.seating.snapshots].slice(0, SNAPSHOT_LIMIT);
  return { ...plan.seating, snapshots: kept };
}

/**
 * Go back to a kept plan.
 *
 * The snapshot list survives the restore — including the snapshot being
 * restored — so going back does not destroy the ability to go forward again,
 * and the current state is kept first so the restore itself is reversible.
 */
export function restoreSnapshot(plan: Plan, id: string): Plan | null {
  const snapshot = plan.seating.snapshots.find((s) => s.id === id);
  if (!snapshot) return null;

  const withCurrent = takeSnapshot(plan, `Before restoring "${snapshot.label}"`);
  // Coerced, not cast: a snapshot is stored data like any other, and one taken
  // by an older version may be missing fields the rest of the app assumes.
  const seating = snapshot.seating as Seating;
  return {
    guests: coerceGuests(snapshot.guests),
    seating: { ...seating, snapshots: withCurrent.snapshots },
  };
}

export function removeSnapshot(seating: Seating, id: string): Seating {
  return { ...seating, snapshots: seating.snapshots.filter((s) => s.id !== id) };
}
