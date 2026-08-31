import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";

/**
 * What a guest is allowed to see.
 *
 * This is the security boundary of the whole sharing feature. Everything
 * published to a guest-facing link passes through here, and it is an allow-list
 * rather than a deny-list on purpose: a field added to `Guest` next year is
 * excluded by default instead of being published because nobody remembered to
 * exclude it.
 *
 * Ported from Tableaux's `server/lib/shareSanitize.js`, which took the same
 * position for the same reason.
 */

export interface SharedGuest {
  /** As printed on the place card. Nothing else about them. */
  name: string;
  table: string | null;
  seat: number | null;
}

export interface SharedTable {
  id: string;
  label: string;
  x: number;
  y: number;
  type: string;
  capacity: number;
  rotation: number;
}

export interface ShareSnapshot {
  coupleNames: string;
  venueName: string;
  date: string;
  guests: SharedGuest[];
  /** Only when the couple asks for the plan to be shown, not just searched. */
  tables: SharedTable[] | null;
  publishedAt: string;
}

export interface ShareOptions {
  /** Draw the room, rather than only answering "where do I sit?". */
  showPlan: boolean;
}

/**
 * Reduce a wedding to a guest-facing snapshot.
 *
 * Names and table numbers. No email addresses, no phone numbers, no dietary
 * requirements, no notes, no RSVP status, no groups, no constraints, no crew,
 * no timeline. A guest looking up their table has no business knowing who is
 * coeliac, and the couple should not have to trust a redaction they cannot see.
 */
export function shareSnapshot(
  guests: Record<string, Guest>,
  seating: Seating,
  event: { coupleNames: string; venueName: string; date: string },
  options: ShareOptions,
): ShareSnapshot {
  const seatOf = new Map<string, { table: string; seat: number | null }>();
  for (const table of Object.values(seating.tables)) {
    table.assignedGuestIds.forEach((id, index) => {
      if (id === null) return;
      seatOf.set(id, {
        table: table.label,
        seat: table.seatMode === "seat" ? index + 1 : null,
      });
    });
  }

  const shared: SharedGuest[] = [];
  for (const guest of Object.values(guests)) {
    // Somebody who has declined is not at the wedding, and publishing that they
    // were invited and said no is not the couple's to publish.
    if (guest.rsvpStatus === "declined") continue;
    const at = seatOf.get(guest.id);
    const name = guestName(guest);
    if (!name) continue;
    shared.push({ name, table: at?.table ?? null, seat: at?.seat ?? null });
  }

  shared.sort((a, b) => a.name.localeCompare(b.name));

  return {
    coupleNames: event.coupleNames,
    venueName: event.venueName,
    date: event.date,
    guests: shared,
    tables: options.showPlan
      ? Object.values(seating.tables)
          .map((t) => ({
            id: t.id,
            label: t.label,
            x: t.x,
            y: t.y,
            type: t.type,
            capacity: t.capacity,
            rotation: t.rotation,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
      : null,
    publishedAt: new Date().toISOString(),
  };
}

const COMBINING = /[̀-ͯ]/g;

const normalise = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Find a guest's table by name.
 *
 * Two characters minimum, and at most a handful of matches, so the box cannot
 * be used to walk the whole list a letter at a time. The snapshot is already
 * decrypted in the guest's own browser by this point — this is about not
 * turning a lookup into a directory, which is a courtesy to the other guests
 * rather than a hard boundary.
 */
export function findSeat(
  snapshot: ShareSnapshot,
  query: string,
  limit = 5,
): SharedGuest[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const matches: SharedGuest[] = [];
  for (const guest of snapshot.guests) {
    if (!normalise(guest.name).includes(q)) continue;
    matches.push(guest);
    if (matches.length >= limit) break;
  }
  return matches;
}
