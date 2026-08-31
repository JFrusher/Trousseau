import { newId } from "./ids";
import type { Guest, Table } from "./types";

/**
 * The full shape of a guest and a table, in one place.
 *
 * Every construction site went through these rather than an object literal, so
 * adding a field to `Guest` is one edit here instead of a compile error in nine
 * files and a silently missing field in whichever one used a cast.
 */

export function newGuest(partial: Partial<Guest> = {}): Guest {
  return {
    id: newId("g"),
    firstName: "",
    lastName: "",
    email: "",
    rsvpStatus: "pending",
    dietary: "",
    entree: "",
    notes: "",
    side: "",
    groupId: null,
    subgroupId: null,
    familyId: null,
    assignedTableId: null,
    tags: [],
    plusOneOf: null,
    ...partial,
  };
}

export function newTable(partial: Partial<Table> = {}): Table {
  return {
    id: newId("t"),
    label: "Table",
    type: "round",
    capacity: 8,
    x: 0,
    y: 0,
    rotation: 0,
    seatMode: "table",
    assignedGuestIds: [],
    designation: null,
    colour: null,
    ...partial,
  };
}
