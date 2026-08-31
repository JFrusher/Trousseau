/**
 * The single source of truth for table types.
 *
 * Ported from Tableaux's `client/src/utils/tableTypes.js`. Sizes are in
 * unscaled canvas pixels; the room's `pixelsPerUnit` turns them into
 * centimetres. The numbers are not adjustable defaults — an existing plan was
 * authored against them, so changing one silently resizes somebody's room.
 */

export type TableShape = "circle" | "rect" | "half-circle";

/**
 * around      — seats evenly distributed around a circle
 * perimeter   — seats on all four sides of a rectangle
 * long-sides  — seats on the two long sides only
 * one-side    — seats on a single long side (top table, facing guests)
 * curved      — seats along the curved edge of a half-circle
 * none        — no individual seats shown (sweetheart)
 */
export type SeatLayout = "around" | "perimeter" | "long-sides" | "one-side" | "curved" | "none";

export interface TableTypeDef {
  id: string;
  label: string;
  shape: TableShape;
  seatLayout: SeatLayout;
  defaultCapacity: number;
  minCapacity: number;
  maxCapacity: number;
  baseRadius?: number;
  width?: number;
  height?: number;
  rounded?: boolean;
  distinctColour?: string;
}

export const TABLE_TYPES: Record<string, TableTypeDef> = {
  round: {
    id: "round",
    label: "Round",
    shape: "circle",
    seatLayout: "around",
    defaultCapacity: 8,
    minCapacity: 2,
    maxCapacity: 14,
    baseRadius: 52,
  },
  rect: {
    id: "rect",
    label: "Rectangle",
    shape: "rect",
    seatLayout: "perimeter",
    defaultCapacity: 10,
    minCapacity: 4,
    maxCapacity: 16,
    width: 150,
    height: 92,
  },
  banquet: {
    id: "banquet",
    label: "Banquet",
    shape: "rect",
    seatLayout: "long-sides",
    defaultCapacity: 16,
    minCapacity: 6,
    maxCapacity: 24,
    width: 260,
    height: 74,
  },
  "top-table": {
    id: "top-table",
    label: "Top table",
    shape: "rect",
    seatLayout: "one-side",
    defaultCapacity: 12,
    minCapacity: 2,
    maxCapacity: 16,
    width: 280,
    height: 64,
  },
  sweetheart: {
    id: "sweetheart",
    label: "Sweetheart",
    shape: "circle",
    seatLayout: "none",
    defaultCapacity: 2,
    minCapacity: 2,
    maxCapacity: 2,
    baseRadius: 34,
  },
  cabaret: {
    id: "cabaret",
    label: "Cabaret",
    shape: "half-circle",
    seatLayout: "curved",
    defaultCapacity: 6,
    minCapacity: 3,
    maxCapacity: 9,
    baseRadius: 60,
  },
  kids: {
    id: "kids",
    label: "Kids",
    shape: "rect",
    seatLayout: "perimeter",
    rounded: true,
    distinctColour: "#C9A24B",
    defaultCapacity: 8,
    minCapacity: 4,
    maxCapacity: 12,
    width: 140,
    height: 88,
  },
};

export const TABLE_TYPE_LIST: readonly TableTypeDef[] = Object.values(TABLE_TYPES);

export const getTableType = (type: string): TableTypeDef =>
  TABLE_TYPES[type] ?? TABLE_TYPES["round"]!;

export const defaultCapacityFor = (type: string): number => getTableType(type).defaultCapacity;

export const clampCapacity = (type: string, capacity: number): number => {
  const t = getTableType(type);
  return Math.max(t.minCapacity, Math.min(t.maxCapacity, Math.round(capacity || 0)));
};
