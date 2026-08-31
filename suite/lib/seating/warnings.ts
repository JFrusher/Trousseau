import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import { getTableType } from "./tableTypes";

/**
 * The rules engine.
 *
 * Ported from Tableaux's `client/src/utils/warnings.js`. Pure: given the two
 * slices it returns a flat list, which the canvas shows as badges and the panel
 * lists. Nothing here blocks anything — a wedding is allowed to be in a
 * half-finished state, and a tool that refuses to let you park a problem is a
 * tool people work around.
 */

export type WarningLevel = "warn" | "info";

export type WarningKind =
  | "over-capacity"
  | "dietary-check"
  | "empty-special"
  | "unassigned"
  | "apart"
  | "together"
  | "family-split";

export interface Warning {
  id: string;
  level: WarningLevel;
  kind: WarningKind;
  message: string;
  tableId?: string;
  guestId?: string;
}

export function computeWarnings(
  guests: Record<string, Guest>,
  seating: Seating,
): Warning[] {
  const out: Warning[] = [];
  const guestList = Object.values(guests);

  for (const table of Object.values(seating.tables)) {
    const ids = table.assignedGuestIds.filter((id): id is string => id !== null);
    const seated = ids.length;

    if (seated > table.capacity) {
      out.push({
        id: `cap_${table.id}`,
        level: "warn",
        kind: "over-capacity",
        tableId: table.id,
        message: `${table.label} is over capacity (${seated}/${table.capacity}).`,
      });
    }

    const sitting = ids.flatMap((id) => (guests[id] ? [guests[id]!] : []));
    const withDiet = sitting.filter((g) => g.dietary).length;
    const without = sitting.filter((g) => !g.dietary).length;
    if (withDiet > 0 && without > 0) {
      out.push({
        id: `diet_${table.id}`,
        level: "info",
        kind: "dietary-check",
        tableId: table.id,
        message: `${table.label}: ${without} ${
          without === 1 ? "guest has" : "guests have"
        } no dietary note while others do — worth checking.`,
      });
    }

    const isSpecial =
      table.type === "sweetheart" ||
      table.type === "top-table" ||
      table.designation === "top-table";
    if (isSpecial && seated === 0) {
      out.push({
        id: `special_${table.id}`,
        level: "info",
        kind: "empty-special",
        tableId: table.id,
        message: `${table.label} (your ${getTableType(table.type).label.toLowerCase()}) has no one seated yet.`,
      });
    }
  }

  // Declined guests are not a seating problem, so they are out of the ratio.
  const eligible = guestList.filter((g) => g.rsvpStatus !== "declined");
  const unassigned = eligible.filter((g) => g.assignedTableId === null).length;
  if (eligible.length > 0 && unassigned / eligible.length > 0.3) {
    out.push({
      id: "unassigned",
      level: "info",
      kind: "unassigned",
      message: `${unassigned} of ${eligible.length} guests (${Math.round(
        (unassigned / eligible.length) * 100,
      )}%) are still unseated.`,
    });
  }

  for (const constraint of seating.constraints) {
    const [aId, bId] = constraint.guestIds;
    const a = guests[aId];
    const b = guests[bId];
    if (!a || !b) continue;

    if (
      constraint.kind === "apart" &&
      a.assignedTableId !== null &&
      a.assignedTableId === b.assignedTableId
    ) {
      out.push({
        id: `cst_${constraint.id}`,
        level: "warn",
        kind: "apart",
        tableId: a.assignedTableId,
        guestId: aId,
        message: `${guestName(a)} and ${guestName(b)} should not sit together — both are at ${
          seating.tables[a.assignedTableId]?.label ?? "the same table"
        }.`,
      });
    }

    if (
      constraint.kind === "together" &&
      a.assignedTableId !== null &&
      b.assignedTableId !== null &&
      a.assignedTableId !== b.assignedTableId
    ) {
      out.push({
        id: `cst_${constraint.id}`,
        level: "warn",
        kind: "together",
        guestId: aId,
        message: `${guestName(a)} and ${guestName(b)} should sit together, but they are at different tables.`,
      });
    }
  }

  // One warning per split family, not one per member. Tableaux pushed a row per
  // person, so a family of five across two tables filled the panel with five
  // near-identical lines saying the same thing.
  for (const family of Object.values(seating.families)) {
    const seated = family.memberIds
      .map((id) => guests[id])
      .filter((g): g is Guest => g !== undefined && g.assignedTableId !== null);
    const tableIds = new Set(seated.map((g) => g.assignedTableId));
    if (tableIds.size <= 1) continue;

    const where = [...tableIds]
      .map((id) => (id === null ? null : seating.tables[id]?.label))
      .filter((label): label is string => Boolean(label))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    out.push({
      id: `fam_${family.id}`,
      level: "warn",
      kind: "family-split",
      ...(seated[0]?.id !== undefined ? { guestId: seated[0].id } : {}),
      message: `The "${family.name}" family is split across ${where.join(", ")}.`,
    });
  }

  return out;
}

export interface WarningIndex {
  byTable: Map<string, Warning[]>;
  byGuest: Map<string, Warning[]>;
}

export function buildWarningIndex(list: Warning[]): WarningIndex {
  const byTable = new Map<string, Warning[]>();
  const byGuest = new Map<string, Warning[]>();
  for (const w of list) {
    if (w.tableId) byTable.set(w.tableId, [...(byTable.get(w.tableId) ?? []), w]);
    if (w.guestId) byGuest.set(w.guestId, [...(byGuest.get(w.guestId) ?? []), w]);
  }
  return { byTable, byGuest };
}
