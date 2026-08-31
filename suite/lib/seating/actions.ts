import { newTable } from "@/lib/model/factories";
import type { Guest, Seating, Table } from "@/lib/model/types";
import { clampCapacity, defaultCapacityFor, getTableType } from "./tableTypes";

/**
 * Every change to who sits where.
 *
 * Pure: each takes the two slices and returns new ones. They live together
 * because a seat is recorded twice — on the table's `assignedGuestIds` and on
 * the guest's `assignedTableId` — and the two disagreeing is a cross-slice
 * error the Trousseau validator refuses a commit for. One function owning both
 * writes is the only way that stays true; a caller that could set one without
 * the other would eventually set one without the other.
 */

export interface Plan {
  guests: Record<string, Guest>;
  seating: Seating;
}

/** "Table 7" — the lowest number not already taken. */
export function nextTableLabel(seating: Seating): string {
  const used = new Set(Object.values(seating.tables).map((t) => t.label));
  for (let n = 1; n <= used.size + 1; n++) {
    const label = `Table ${n}`;
    if (!used.has(label)) return label;
  }
  return `Table ${used.size + 1}`;
}

export function addTable(seating: Seating, type: string, at: { x: number; y: number }): Seating {
  const def = getTableType(type);
  const table = newTable({
    label: def.seatLayout === "none" ? "Sweetheart" : nextTableLabel(seating),
    type: def.id,
    capacity: defaultCapacityFor(def.id),
    x: Math.round(at.x),
    y: Math.round(at.y),
    seatMode: seating.settings.defaultSeatMode,
  });
  return { ...seating, tables: { ...seating.tables, [table.id]: table } };
}

export function patchTable(seating: Seating, id: string, patch: Partial<Table>): Seating {
  const table = seating.tables[id];
  if (!table) return seating;
  const next: Table = { ...table, ...patch };
  if (patch.capacity !== undefined) next.capacity = clampCapacity(next.type, patch.capacity);
  if (patch.type !== undefined) next.capacity = clampCapacity(next.type, next.capacity);
  return { ...seating, tables: { ...seating.tables, [id]: next } };
}

/**
 * Removing a table frees everyone at it rather than deleting them. Losing
 * guests because a table was dragged to the bin is not a recoverable mistake.
 */
export function removeTable(plan: Plan, id: string): Plan {
  const table = plan.seating.tables[id];
  if (!table) return plan;

  const guests = { ...plan.guests };
  for (const guestId of table.assignedGuestIds) {
    const guest = guestId === null ? undefined : guests[guestId];
    if (guest && guest.assignedTableId === id) {
      guests[guest.id] = { ...guest, assignedTableId: null };
    }
  }

  const tables = { ...plan.seating.tables };
  delete tables[id];
  return { guests, seating: { ...plan.seating, tables } };
}

/**
 * Seat a guest, optionally at a numbered seat.
 *
 * Always unseats them from wherever they were first, so that dragging someone
 * across the room cannot leave a ghost of them at the old table. A seat index
 * already taken swaps the two guests rather than overwriting — the person
 * sitting there does not simply vanish.
 */
export function seatGuest(plan: Plan, guestId: string, tableId: string, seatIndex?: number): Plan {
  const guest = plan.guests[guestId];
  const table = plan.seating.tables[tableId];
  if (!guest || !table) return plan;

  const freed = unseatGuest(plan, guestId);
  const target = freed.seating.tables[tableId]!;
  const ids = [...target.assignedGuestIds];

  if (seatIndex === undefined) {
    const hole = ids.indexOf(null);
    if (hole >= 0) ids[hole] = guestId;
    else ids.push(guestId);
  } else {
    while (ids.length <= seatIndex) ids.push(null);
    const displaced = ids[seatIndex] ?? null;
    ids[seatIndex] = guestId;
    // The guest who was in that seat goes to the first free one at the same
    // table, or on the end. They are never dropped.
    if (displaced !== null && displaced !== guestId) {
      const hole = ids.indexOf(null);
      if (hole >= 0) ids[hole] = displaced;
      else ids.push(displaced);
    }
  }

  return {
    guests: { ...freed.guests, [guestId]: { ...freed.guests[guestId]!, assignedTableId: tableId } },
    seating: {
      ...freed.seating,
      tables: { ...freed.seating.tables, [tableId]: { ...target, assignedGuestIds: ids } },
    },
  };
}

export function unseatGuest(plan: Plan, guestId: string): Plan {
  const guest = plan.guests[guestId];
  if (!guest) return plan;

  const tables = { ...plan.seating.tables };
  let touched = false;
  for (const [id, table] of Object.entries(tables)) {
    if (!table.assignedGuestIds.includes(guestId)) continue;
    touched = true;
    tables[id] = {
      ...table,
      // Seat-mode tables keep the hole, so seat 5 stays seat 5 when seat 3
      // empties. Table-mode ones close up, because the order means nothing.
      assignedGuestIds:
        table.seatMode === "seat"
          ? table.assignedGuestIds.map((g) => (g === guestId ? null : g))
          : table.assignedGuestIds.filter((g) => g !== guestId),
    };
  }

  if (!touched && guest.assignedTableId === null) return plan;

  return {
    guests: { ...plan.guests, [guestId]: { ...guest, assignedTableId: null } },
    seating: { ...plan.seating, tables },
  };
}

/** Everyone on the list who is not at a table, in a stable, readable order. */
export function unseated(plan: Plan): Guest[] {
  return Object.values(plan.guests)
    .filter((g) => g.assignedTableId === null)
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.id.localeCompare(b.id),
    );
}

/** Guests at a table, in seat order. Holes and dangling ids drop out. */
export function seatedAt(plan: Plan, tableId: string): Array<{ seat: number; guest: Guest }> {
  const table = plan.seating.tables[tableId];
  if (!table) return [];
  return table.assignedGuestIds.flatMap((id, seat) => {
    const guest = id === null ? undefined : plan.guests[id];
    return guest ? [{ seat, guest }] : [];
  });
}

/**
 * Rebuild both sides of the link from the tables' own lists.
 *
 * Runs on a restored document, where the two may already disagree — an older
 * export, a hand-edited file, or two apps that were never reconciled. The
 * tables win, because a seat that exists on the plan is the one a person can
 * point at in the room.
 */
export function reconcile(plan: Plan): Plan {
  const guests = { ...plan.guests };
  const claimed = new Map<string, string>();

  for (const table of Object.values(plan.seating.tables)) {
    for (const id of table.assignedGuestIds) {
      if (id !== null && !claimed.has(id)) claimed.set(id, table.id);
    }
  }

  let changed = false;
  for (const guest of Object.values(plan.guests)) {
    const seat = claimed.get(guest.id) ?? null;
    if (guest.assignedTableId !== seat) {
      guests[guest.id] = { ...guest, assignedTableId: seat };
      changed = true;
    }
  }

  return changed ? { guests, seating: plan.seating } : plan;
}
