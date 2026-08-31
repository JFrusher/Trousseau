import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import { getTableType } from "./tableTypes";

/**
 * The numbers the couple actually ask for, and the caterer needs.
 *
 * Derived on every read rather than stored. A count kept in the document is a
 * count that goes stale the first time somebody edits the document by hand, and
 * these are cheap.
 */

export interface Tally {
  label: string;
  count: number;
}

export interface SeatingStats {
  guests: number;
  confirmed: number;
  declined: number;
  pending: number;
  seated: number;
  /** Confirmed guests without a table — the number that has to reach zero. */
  outstanding: number;
  tables: number;
  capacity: number;
  /** Seats going spare across every table. Negative means over-subscribed. */
  spare: number;
  dietary: Tally[];
  entrees: Tally[];
  sides: Tally[];
  /** Tables past their own capacity, by label. */
  overfull: string[];
}

export function computeStats(guests: Record<string, Guest>, seating: Seating): SeatingStats {
  const list = Object.values(guests);
  const tables = Object.values(seating.tables);

  const confirmed = list.filter((g) => g.rsvpStatus === "confirmed");
  const capacity = tables.reduce((sum, t) => sum + t.capacity, 0);
  const seated = list.filter((g) => g.assignedTableId !== null).length;

  return {
    guests: list.length,
    confirmed: confirmed.length,
    declined: list.filter((g) => g.rsvpStatus === "declined").length,
    pending: list.filter((g) => g.rsvpStatus === "pending").length,
    seated,
    outstanding: confirmed.filter((g) => g.assignedTableId === null).length,
    tables: tables.length,
    capacity,
    spare: capacity - seated,
    // Declined guests are excluded: the kitchen cooks for who is coming.
    dietary: tally(confirmed.map((g) => g.dietary.trim()).filter(Boolean)),
    entrees: tally(confirmed.map((g) => g.entree.trim()).filter(Boolean)),
    sides: tally(
      confirmed.map((g) =>
        g.side === "" ? "Not said" : g.side.charAt(0).toUpperCase() + g.side.slice(1),
      ),
    ),
    overfull: tables
      .filter((t) => t.assignedGuestIds.filter(Boolean).length > t.capacity)
      .map((t) => t.label),
  };
}

/** Counted case-insensitively but labelled as first written, biggest first. */
function tally(values: string[]): Tally[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const key = value.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label: value, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface TableReport {
  label: string;
  type: string;
  capacity: number;
  seated: number;
  guests: Array<{ seat: number | null; name: string; dietary: string; entree: string }>;
}

/**
 * One row per table, for the printed report and the caterer's sheet.
 *
 * Sorted numerically, so Table 10 comes after Table 9 rather than after Table 1
 * — which is where a plain sort puts it, and where nobody looks for it.
 */
export function tableReports(guests: Record<string, Guest>, seating: Seating): TableReport[] {
  return Object.values(seating.tables)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map((table) => ({
      label: table.label,
      type: getTableType(table.type).label,
      capacity: table.capacity,
      seated: table.assignedGuestIds.filter(Boolean).length,
      guests: table.assignedGuestIds.flatMap((id, index) => {
        const guest = id === null ? undefined : guests[id];
        if (!guest) return [];
        return [
          {
            seat: table.seatMode === "seat" ? index + 1 : null,
            name: guestName(guest),
            dietary: guest.dietary,
            entree: guest.entree,
          },
        ];
      }),
    }));
}
