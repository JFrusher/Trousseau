import { newId } from "@/lib/model/ids";
import type { CastRole, Guest, Seating, ShotSection, Side } from "@/lib/model/types";

/**
 * Starting points for the shot list. `generate` is `template` plus one shot
 * per family and named group, so there is exactly one place that builds the
 * classic sections. Takes the *current* sections and merges into them —
 * matched and reused by name, each shot added only if no shot with that exact
 * label already exists in its section — so pressing either button twice adds
 * nothing the second time.
 */

interface ClassicShot {
  label: string;
  roles: CastRole[];
}
interface ClassicSection {
  name: string;
  shots: ClassicShot[];
}

const CLASSIC: ClassicSection[] = [
  { name: "The couple", shots: [{ label: "The couple, alone", roles: ["bride", "groom"] }] },
  {
    name: "Bride's family",
    shots: [
      { label: "Couple with the bride's parents", roles: ["bride", "groom", "brides-mother", "brides-father"] },
      { label: "The bride with her parents", roles: ["bride", "brides-mother", "brides-father"] },
      { label: "The bride with her mother", roles: ["bride", "brides-mother"] },
      { label: "The bride with her father", roles: ["bride", "brides-father"] },
    ],
  },
  {
    name: "Groom's family",
    shots: [
      { label: "Couple with the groom's parents", roles: ["bride", "groom", "grooms-mother", "grooms-father"] },
      { label: "The groom with his parents", roles: ["groom", "grooms-mother", "grooms-father"] },
      { label: "The groom with his mother", roles: ["groom", "grooms-mother"] },
      { label: "The groom with his father", roles: ["groom", "grooms-father"] },
    ],
  },
  {
    name: "Both families",
    shots: [
      {
        label: "Couple with all four parents",
        roles: ["bride", "groom", "brides-mother", "brides-father", "grooms-mother", "grooms-father"],
      },
    ],
  },
  {
    name: "Wedding party",
    shots: [
      { label: "The full wedding party", roles: ["bride", "groom", "bridal-party", "groomsmen"] },
      { label: "The bride with her bridal party", roles: ["bride", "bridal-party"] },
      { label: "The groom with his groomsmen", roles: ["groom", "groomsmen"] },
    ],
  },
];

const SECTION_FOR: Record<"bride" | "groom" | "both", string> = {
  bride: "Bride's family",
  groom: "Groom's family",
  both: "Both families",
};

function sectionNamed(sections: ShotSection[], name: string): ShotSection {
  const found = sections.find((s) => s.name === name);
  if (found) return found;
  const created: ShotSection = { id: newId("sec"), name, shots: [] };
  sections.push(created);
  return created;
}

function sideOf(guestIds: string[], guests: Record<string, Guest>): Side | null {
  let brideCount = 0;
  let groomCount = 0;
  for (const id of guestIds) {
    const side = guests[id]?.side;
    if (side === "bride") brideCount += 1;
    else if (side === "groom") groomCount += 1;
  }
  if (brideCount === 0 && groomCount === 0) return null;
  if (brideCount === groomCount) return "both";
  return brideCount > groomCount ? "bride" : "groom";
}

function appendFamiliesAndGroups(sections: ShotSection[], guests: Record<string, Guest>, seating: Seating): void {
  for (const family of Object.values(seating.families)) {
    const side = sideOf(family.memberIds, guests) ?? "both";
    const section = sectionNamed(sections, SECTION_FOR[side as "bride" | "groom" | "both"]);
    if (section.shots.some((s) => s.label === family.name)) continue;
    section.shots.push({ id: newId("shot"), label: family.name, members: [{ kind: "family", ref: family.id }], notes: "" });
  }

  const namedGroups = { ...seating.groups, ...seating.subgroups };
  for (const group of Object.values(namedGroups)) {
    const memberIds = Object.values(guests)
      .filter((g) => g.groupId === group.id || g.subgroupId === group.id)
      .map((g) => g.id);
    const side = sideOf(memberIds, guests) ?? "both";
    const section = sectionNamed(sections, SECTION_FOR[side as "bride" | "groom" | "both"]);
    if (section.shots.some((s) => s.label === group.name)) continue;
    section.shots.push({ id: newId("shot"), label: group.name, members: [{ kind: "group", ref: group.id }], notes: "" });
  }
}

export function propose(
  existing: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  mode: "template" | "generate",
): ShotSection[] {
  const sections = existing.map((s) => ({ ...s, shots: [...s.shots] }));

  for (const classic of CLASSIC) {
    const section = sectionNamed(sections, classic.name);
    for (const shot of classic.shots) {
      if (section.shots.some((s) => s.label === shot.label)) continue;
      section.shots.push({
        id: newId("shot"),
        label: shot.label,
        members: shot.roles.map((role) => ({ kind: "role" as const, ref: role })),
        notes: "",
      });
    }
  }

  if (mode === "generate") appendFamiliesAndGroups(sections, guests, seating);

  return sections;
}
