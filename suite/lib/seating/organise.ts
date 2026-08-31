import { newId } from "@/lib/model/ids";
import { guestName } from "@/lib/model/slices";
import type { Constraint, ConstraintKind, Guest, NamedGroup, Seating } from "@/lib/model/types";
import type { Plan } from "./actions";

/**
 * How the guest list is organised: groups, subgroups, families and the rules
 * about who may sit with whom.
 *
 * The three collection kinds are a hierarchy of intent, not of storage. A group
 * is broad ("Bride's side"), a subgroup narrows it ("University"), and a family
 * is the one that carries a rule with it — a family split across two tables is
 * a warning, the other two never are.
 */

export type Collection = "groups" | "subgroups" | "families";

/** The palette a new group is coloured from, in order, so two rarely clash. */
const GROUP_COLOURS = [
  "#849E86",
  "#C48B8B",
  "#D4AF37",
  "#7C8FA6",
  "#B08968",
  "#8E7CA6",
  "#A6907C",
];

export function addGroup(seating: Seating, kind: Collection, name: string): Seating {
  const clean = name.trim();
  if (!clean) return seating;

  const existing = seating[kind];
  const colour = GROUP_COLOURS[Object.keys(existing).length % GROUP_COLOURS.length]!;

  if (kind === "families") {
    const family = { id: newId("fam"), name: clean, colour, memberIds: [] };
    return { ...seating, families: { ...seating.families, [family.id]: family } };
  }

  const group: NamedGroup = { id: newId(kind === "groups" ? "grp" : "sub"), name: clean, colour };
  return { ...seating, [kind]: { ...existing, [group.id]: group } };
}

export function renameGroup(
  seating: Seating,
  kind: Collection,
  id: string,
  name: string,
): Seating {
  const existing = seating[kind][id];
  if (!existing) return seating;
  return { ...seating, [kind]: { ...seating[kind], [id]: { ...existing, name } } };
}

/**
 * Removing a collection detaches its members rather than deleting them.
 *
 * Deleting the "University" subgroup must not delete twelve guests, and the
 * only way to be sure of that is for this function never to touch the guest
 * record except to clear the pointer.
 */
export function removeGroup(plan: Plan, kind: Collection, id: string): Plan {
  const existing = plan.seating[kind][id];
  if (!existing) return plan;

  const field = kind === "groups" ? "groupId" : kind === "subgroups" ? "subgroupId" : "familyId";
  const guests = { ...plan.guests };
  for (const guest of Object.values(plan.guests)) {
    if (guest[field] === id) guests[guest.id] = { ...guest, [field]: null };
  }

  const next = { ...plan.seating[kind] };
  delete next[id];
  return { guests, seating: { ...plan.seating, [kind]: next } };
}

/**
 * Put a guest in a collection, or take them out with `null`.
 *
 * A family keeps its own member list as well as the pointer on the guest, so
 * both are written here. Two records of one fact is the same hazard as a seat,
 * and the answer is the same: one function owns both.
 */
export function assignToGroup(
  plan: Plan,
  guestId: string,
  kind: Collection,
  groupId: string | null,
): Plan {
  const guest = plan.guests[guestId];
  if (!guest) return plan;

  const field = kind === "groups" ? "groupId" : kind === "subgroups" ? "subgroupId" : "familyId";
  const guests = { ...plan.guests, [guestId]: { ...guest, [field]: groupId } };

  if (kind !== "families") return { guests, seating: plan.seating };

  const families = { ...plan.seating.families };
  for (const family of Object.values(plan.seating.families)) {
    const shouldHold = family.id === groupId;
    const holds = family.memberIds.includes(guestId);
    if (shouldHold && !holds) {
      families[family.id] = { ...family, memberIds: [...family.memberIds, guestId] };
    } else if (!shouldHold && holds) {
      families[family.id] = {
        ...family,
        memberIds: family.memberIds.filter((m) => m !== guestId),
      };
    }
  }

  return { guests, seating: { ...plan.seating, families } };
}

// constraints -------------------------------------------------------------

export function addConstraint(
  seating: Seating,
  kind: ConstraintKind,
  a: string,
  b: string,
  note = "",
): Seating {
  // A rule about someone and themselves is not a rule.
  if (a === b) return seating;

  // Order-insensitive: "Alice apart from Bob" and the reverse are one rule, and
  // recording both would report every violation twice.
  const already = seating.constraints.some(
    (c) => c.guestIds.includes(a) && c.guestIds.includes(b),
  );
  if (already) return seating;

  const constraint: Constraint = { id: newId("cst"), kind, guestIds: [a, b], note };
  return { ...seating, constraints: [...seating.constraints, constraint] };
}

export const removeConstraint = (seating: Seating, id: string): Seating => ({
  ...seating,
  constraints: seating.constraints.filter((c) => c.id !== id),
});

/**
 * Constraints naming a guest who is no longer on the list.
 *
 * Reported rather than swept away: a rule that quietly stopped applying because
 * somebody was re-imported under a new id is exactly the silent failure that
 * puts two people who cannot be together on one table.
 */
export function danglingConstraints(plan: Plan): Constraint[] {
  return plan.seating.constraints.filter(
    (c) => !plan.guests[c.guestIds[0]] || !plan.guests[c.guestIds[1]],
  );
}

/** A readable description of a rule, for the list and for the warning text. */
export function describeConstraint(plan: Plan, constraint: Constraint): string {
  const name = (id: string) => {
    const guest = plan.guests[id];
    return guest ? guestName(guest) : "someone no longer on the list";
  };
  const verb = constraint.kind === "together" ? "with" : "apart from";
  return `${name(constraint.guestIds[0])} ${verb} ${name(constraint.guestIds[1])}`;
}

// filtering ---------------------------------------------------------------

export interface GuestFilter {
  query: string;
  rsvp: "all" | "confirmed" | "pending" | "declined";
  side: "all" | "bride" | "groom" | "both";
  seated: "all" | "seated" | "unseated";
  groupId: string | null;
  /** Only guests carrying every one of these tags. */
  tags: string[];
}

export const EMPTY_FILTER: GuestFilter = {
  query: "",
  rsvp: "all",
  side: "all",
  seated: "all",
  groupId: null,
  tags: [],
};

/**
 * Everyone matching the filter.
 *
 * Search covers the name, the dietary note and free-text notes, because "who
 * was the coeliac?" is a question people actually ask of this box.
 */
export function filterGuests(guests: Guest[], filter: GuestFilter): Guest[] {
  const q = filter.query.trim().toLowerCase();

  return guests.filter((guest) => {
    if (q) {
      const haystack = `${guestName(guest)} ${guest.dietary} ${guest.notes} ${guest.email}`;
      if (!haystack.toLowerCase().includes(q)) return false;
    }
    if (filter.rsvp !== "all" && guest.rsvpStatus !== filter.rsvp) return false;
    if (filter.side !== "all" && guest.side !== filter.side) return false;
    if (filter.seated === "seated" && guest.assignedTableId === null) return false;
    if (filter.seated === "unseated" && guest.assignedTableId !== null) return false;
    if (filter.groupId !== null && guest.groupId !== filter.groupId) return false;
    if (filter.tags.length > 0 && !filter.tags.every((t) => guest.tags.includes(t))) return false;
    return true;
  });
}

/** Every tag anybody carries, sorted, for the filter chips. */
export function allGuestTags(guests: Guest[]): string[] {
  const seen = new Set<string>();
  for (const guest of guests) for (const tag of guest.tags) seen.add(tag);
  return [...seen].sort((a, b) => a.localeCompare(b));
}
