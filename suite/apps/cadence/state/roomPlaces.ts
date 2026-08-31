/**
 * The named parts of the room, for the Location field on a block.
 *
 * Cadence's `location` is free text and stays free text — the church down the
 * road is a real location even though nobody has drawn it on the floor plan.
 * But when the ceremony happens in the Orangery, and someone has already drawn
 * an Orangery next door, the two should be spelled the same. Offering the list
 * is enough to make that happen without either tool having to own the other's
 * idea of a place.
 *
 * Read from the raw slice rather than the typed reader, because the suite's
 * `Seating` type carries a `zones` map that Tableaux does not populate: the
 * spaces you actually draw live under `room.spaces`.
 */
export function roomPlaces(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];

  const room = (raw as Record<string, unknown>)["room"];
  if (typeof room !== "object" || room === null) return [];

  const spaces = (room as Record<string, unknown>)["spaces"];
  if (!Array.isArray(spaces)) return [];

  const labels = spaces
    .map((space) =>
      typeof space === "object" && space !== null
        ? String((space as Record<string, unknown>)["label"] ?? "")
        : "",
    )
    .filter(Boolean);

  return [...new Set(labels)].sort((a, b) => a.localeCompare(b, "en"));
}
