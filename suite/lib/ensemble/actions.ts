import { newId } from "@/lib/model/ids";
import type { Cast, CastRole, Shot, ShotMember, ShotSection, Shots } from "@/lib/model/types";

/**
 * The shot list: sections holding shots holding members. A shot lives inside
 * its section rather than in a flat record, so an orphaned shot is
 * unrepresentable and reordering is an array splice.
 */

export function addSection(shots: Shots, name = "New section"): Shots {
  const section: ShotSection = { id: newId("sec"), name, shots: [] };
  return { ...shots, sections: [...shots.sections, section] };
}

export function renameSection(shots: Shots, sectionId: string, name: string): Shots {
  return { ...shots, sections: shots.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) };
}

export function removeSection(shots: Shots, sectionId: string): Shots {
  return { ...shots, sections: shots.sections.filter((s) => s.id !== sectionId) };
}

export function reorderSections(shots: Shots, fromIndex: number, toIndex: number): Shots {
  const sections = [...shots.sections];
  const [moved] = sections.splice(fromIndex, 1);
  if (!moved) return shots;
  sections.splice(toIndex, 0, moved);
  return { ...shots, sections };
}

export function addShot(shots: Shots, sectionId: string): Shots {
  const shot: Shot = { id: newId("shot"), label: "", members: [], notes: "" };
  return {
    ...shots,
    sections: shots.sections.map((s) => (s.id === sectionId ? { ...s, shots: [...s.shots, shot] } : s)),
  };
}

export function patchShot(shots: Shots, shotId: string, patch: Partial<Shot>): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({
      ...s,
      shots: s.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
    })),
  };
}

export function removeShot(shots: Shots, shotId: string): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({ ...s, shots: s.shots.filter((shot) => shot.id !== shotId) })),
  };
}

/** Moves a shot to an index within its own section. A cross-section move is two calls. */
export function reorderShot(shots: Shots, sectionId: string, fromIndex: number, toIndex: number): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const list = [...s.shots];
      const [moved] = list.splice(fromIndex, 1);
      if (!moved) return s;
      list.splice(toIndex, 0, moved);
      return { ...s, shots: list };
    }),
  };
}

export function addMember(shots: Shots, shotId: string, member: ShotMember): Shots {
  return patchShotMembers(shots, shotId, (members) => [...members, member]);
}

export function removeMember(shots: Shots, shotId: string, index: number): Shots {
  return patchShotMembers(shots, shotId, (members) => members.filter((_, i) => i !== index));
}

function patchShotMembers(
  shots: Shots,
  shotId: string,
  update: (members: ShotMember[]) => ShotMember[],
): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({
      ...s,
      shots: s.shots.map((shot) => (shot.id === shotId ? { ...shot, members: update(shot.members) } : shot)),
    })),
  };
}

export function setCastRole(shots: Shots, role: CastRole, guestIds: string[]): Shots {
  return { ...shots, cast: { ...shots.cast, [role]: guestIds } as Cast };
}
