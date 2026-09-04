import { toCsv } from "@/lib/data/csv";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { resolveShot } from "./resolve";

/** Section, number, shot, the resolved names, and the note. The sheet a photographer prints. */
export function shotListCsv(
  sections: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
): string {
  const headers = ["Section", "No", "Shot", "People", "Notes"];
  const rows: string[][] = [];
  let number = 0;

  for (const section of sections) {
    for (const shot of section.shots) {
      number += 1;
      const resolved = resolveShot(shot, guests, seating, cast);
      rows.push([section.name, String(number), resolved.label, resolved.people.map((p) => p.name).join(", "), shot.notes]);
    }
  }

  return toCsv(headers, rows);
}
