import { guestName } from "@/lib/model/slices";
import { ROLE_LABEL, type Cast, type CastRole, type Guest, type RsvpStatus, type Seating, type Shot, type ShotMember } from "@/lib/model/types";

export interface ResolvedPerson {
  guestId: string | null;
  name: string;
  rsvpStatus: RsvpStatus | null;
}

export type ShotProblem =
  | { kind: "dangling"; detail: string }
  | { kind: "declined"; name: string }
  | { kind: "empty" };

export interface ResolvedShot {
  label: string;
  people: ResolvedPerson[];
  problems: ShotProblem[];
}

const rolePhrase = (role: CastRole): string => `the ${ROLE_LABEL[role].toLowerCase()}`;

/**
 * A shot's members, resolved to the people they name right now.
 *
 * Order is preserved as authored, and a guest named twice — once directly,
 * once through a family they belong to — is printed once, at its first
 * position. `guestId` is null for a free-text member, which cannot dedupe
 * against anything and never carries a declined warning.
 */
export function resolveShot(
  shot: Shot,
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
): ResolvedShot {
  const people: ResolvedPerson[] = [];
  const seen = new Set<string>();
  const problems: ShotProblem[] = [];

  const addGuest = (guestId: string, source: string) => {
    const guest = guests[guestId];
    if (!guest) {
      problems.push({ kind: "dangling", detail: `${source} names a guest who no longer exists` });
      return;
    }
    if (seen.has(guestId)) return;
    seen.add(guestId);
    const name = guestName(guest) || "Unnamed guest";
    people.push({ guestId, name, rsvpStatus: guest.rsvpStatus });
    if (guest.rsvpStatus === "declined") problems.push({ kind: "declined", name });
  };

  for (const member of shot.members) {
    resolveMember(member, guests, seating, cast, addGuest, problems, people);
  }

  if (people.length === 0 && shot.members.length === 0) problems.push({ kind: "empty" });

  const label =
    shot.label.trim() || (people.length > 0 ? people.map((p) => p.name).join(" + ") : "Untitled shot");

  return { label, people, problems };
}

function resolveMember(
  member: ShotMember,
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
  addGuest: (guestId: string, source: string) => void,
  problems: ShotProblem[],
  people: ResolvedPerson[],
): void {
  switch (member.kind) {
    case "guest":
      addGuest(member.ref, "A shot member");
      return;
    case "family": {
      const family = seating.families[member.ref];
      if (!family) {
        problems.push({ kind: "dangling", detail: "A shot member names a family that no longer exists" });
        return;
      }
      for (const guestId of family.memberIds) addGuest(guestId, `"${family.name}"`);
      return;
    }
    case "group": {
      const group = seating.groups[member.ref] ?? seating.subgroups[member.ref];
      if (!group) {
        problems.push({ kind: "dangling", detail: "A shot member names a group that no longer exists" });
        return;
      }
      for (const guest of Object.values(guests)) {
        if (guest.groupId === member.ref || guest.subgroupId === member.ref) addGuest(guest.id, `"${group.name}"`);
      }
      return;
    }
    case "role": {
      const guestIds = cast[member.ref];
      if (guestIds.length === 0) {
        problems.push({ kind: "dangling", detail: `No one is set as ${rolePhrase(member.ref)} yet` });
        return;
      }
      for (const guestId of guestIds) addGuest(guestId, rolePhrase(member.ref));
      return;
    }
    case "text":
      people.push({ guestId: null, name: member.ref, rsvpStatus: null });
      return;
  }
}
