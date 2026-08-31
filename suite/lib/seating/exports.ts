import { toCsv } from "@/lib/data/csv";
import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import { computeStats, tableReports } from "./stats";
import { getTableType } from "./tableTypes";

/**
 * Taking the plan out of the app as something else can read.
 *
 * All of these are text: a CSV a spreadsheet opens, an SVG a printer or a
 * designer opens. Nothing here needs a PDF library, and the one thing that does
 * — the place cards — has its own.
 */

/** Every guest, with where they sit. The sheet a caterer is usually sent. */
export function guestListCsv(guests: Record<string, Guest>, seating: Seating): string {
  const headers = [
    "First Name",
    "Last Name",
    "Table",
    "Seat",
    "RSVP",
    "Dietary",
    "Main",
    "Side",
    "Group",
    "Family",
    "Email",
    "Notes",
  ];

  const seatOf = new Map<string, { table: string; seat: string }>();
  for (const table of Object.values(seating.tables)) {
    table.assignedGuestIds.forEach((id, index) => {
      if (id === null) return;
      seatOf.set(id, {
        table: table.label,
        seat: table.seatMode === "seat" ? String(index + 1) : "",
      });
    });
  }

  const rows = Object.values(guests)
    .sort(
      (a, b) =>
        (seatOf.get(a.id)?.table ?? "￿").localeCompare(
          seatOf.get(b.id)?.table ?? "￿",
          undefined,
          { numeric: true },
        ) || a.lastName.localeCompare(b.lastName),
    )
    .map((guest) => {
      const at = seatOf.get(guest.id);
      return [
        guest.firstName,
        guest.lastName,
        at?.table ?? "",
        at?.seat ?? "",
        guest.rsvpStatus,
        guest.dietary,
        guest.entree,
        guest.side,
        seating.groups[guest.groupId ?? ""]?.name ?? "",
        seating.families[guest.familyId ?? ""]?.name ?? "",
        guest.email,
        guest.notes,
      ];
    });

  return toCsv(headers, rows);
}

/** A table at a time, with its people under it. The front-of-house sheet. */
export function tablePlanCsv(guests: Record<string, Guest>, seating: Seating): string {
  const rows: string[][] = [];
  for (const report of tableReports(guests, seating)) {
    rows.push([report.label, `${report.seated}/${report.capacity}`, report.type, "", "", ""]);
    for (const guest of report.guests) {
      rows.push(["", "", "", guest.seat === null ? "" : String(guest.seat), guest.name, guest.dietary]);
    }
  }
  return toCsv(["Table", "Seated", "Type", "Seat", "Guest", "Dietary"], rows);
}

/** Counts, for the caterer and the couple's own sanity. */
export function summaryCsv(guests: Record<string, Guest>, seating: Seating): string {
  const stats = computeStats(guests, seating);
  const rows: string[][] = [
    ["Guests", String(stats.guests)],
    ["Confirmed", String(stats.confirmed)],
    ["Declined", String(stats.declined)],
    ["Awaiting reply", String(stats.pending)],
    ["Seated", String(stats.seated)],
    ["Confirmed with no table", String(stats.outstanding)],
    ["Tables", String(stats.tables)],
    ["Seats", String(stats.capacity)],
    ["Seats spare", String(stats.spare)],
    ["", ""],
  ];
  for (const [heading, tallies] of [
    ["Dietary", stats.dietary],
    ["Main course", stats.entrees],
    ["Side", stats.sides],
  ] as const) {
    rows.push([heading, ""]);
    for (const t of tallies) rows.push([t.label, String(t.count)]);
    rows.push(["", ""]);
  }
  return toCsv(["What", "Count"], rows);
}

/**
 * The floor plan, as an SVG.
 *
 * Vector, so it prints at any size and a designer can open it. Deliberately not
 * a PDF: an SVG needs no library, every browser and print shop reads one, and
 * turning it into a PDF is a File → Print away.
 */
export function floorPlanSvg(
  guests: Record<string, Guest>,
  seating: Seating,
  geometryOf: (tableId: string) => { width: number; height: number; shape: string; radius: number },
  title: string,
): string {
  const pad = 60;
  const bounds = planBounds(seating, geometryOf, pad);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}" width="${Math.round(bounds.w)}" height="${Math.round(bounds.h)}">`,
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="#FDFBF7"/>`,
  );

  for (const space of seating.room.spaces) {
    if (space.shape === "rect") {
      parts.push(
        `<rect x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" fill="${space.backgroundColour}" stroke="#1C1917" stroke-opacity="0.35" stroke-width="2"/>`,
      );
    } else if (space.vertices.length > 0) {
      const points = space.vertices.map((v) => `${space.x + v.x},${space.y + v.y}`).join(" ");
      parts.push(
        `<polygon points="${points}" fill="${space.backgroundColour}" stroke="#1C1917" stroke-opacity="0.35" stroke-width="2"/>`,
      );
    }
  }

  for (const zone of Object.values(seating.zones)) {
    parts.push(
      `<rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" fill="${zone.colour}" fill-opacity="0.12" stroke="${zone.colour}" stroke-dasharray="6 4"/>`,
      `<text x="${zone.x + zone.width / 2}" y="${zone.y + 18}" text-anchor="middle" font-size="13" fill="#44403C">${escapeXml(zone.label)}</text>`,
    );
  }

  for (const o of Object.values(seating.obstacles)) {
    const shape =
      o.kind === "pillar"
        ? `<ellipse cx="${o.x}" cy="${o.y}" rx="${o.width / 2}" ry="${o.height / 2}" fill="#44403C" fill-opacity="0.5"/>`
        : `<rect x="${o.x - o.width / 2}" y="${o.y - o.height / 2}" width="${o.width}" height="${o.height}" fill="#44403C" fill-opacity="0.5" transform="rotate(${o.rotation} ${o.x} ${o.y})"/>`;
    parts.push(shape);
  }

  for (const table of Object.values(seating.tables)) {
    const g = geometryOf(table.id);
    const seated = table.assignedGuestIds.filter(Boolean).length;
    const body =
      g.shape === "circle"
        ? `<circle r="${g.radius}" fill="#FFFFFF" stroke="#1C1917" stroke-width="1.5"/>`
        : g.shape === "half-circle"
          ? `<path d="M ${-g.radius} ${g.radius / 2} A ${g.radius} ${g.radius} 0 0 1 ${g.radius} ${g.radius / 2} Z" fill="#FFFFFF" stroke="#1C1917" stroke-width="1.5"/>`
          : `<rect x="${-g.width / 2}" y="${-g.height / 2}" width="${g.width}" height="${g.height}" fill="#FFFFFF" stroke="#1C1917" stroke-width="1.5"/>`;

    parts.push(
      `<g transform="translate(${table.x} ${table.y}) rotate(${table.rotation})">`,
      body,
      `<text text-anchor="middle" font-size="14" fill="#1C1917">${escapeXml(table.label)}</text>`,
      `<text y="15" text-anchor="middle" font-size="10" fill="#44403C">${seated}/${table.capacity}</text>`,
      `</g>`,
    );
  }

  parts.push(
    `<text x="${bounds.x + 16}" y="${bounds.y + 28}" font-size="18" fill="#1C1917">${escapeXml(title)}</text>`,
    `<text x="${bounds.x + 16}" y="${bounds.y + 46}" font-size="11" fill="#44403C">${Object.keys(seating.tables).length} tables · ${Object.values(guests).filter((g) => g.assignedTableId !== null).length} seated</text>`,
    "</svg>",
  );
  return parts.join("\n");
}

function planBounds(
  seating: Seating,
  geometryOf: (id: string) => { width: number; height: number },
  pad: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const grow = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const sp of seating.room.spaces) {
    if (sp.shape === "rect") grow(sp.x, sp.y, sp.width, sp.height);
    else for (const v of sp.vertices) grow(sp.x + v.x, sp.y + v.y, 0, 0);
  }
  for (const t of Object.values(seating.tables)) {
    const g = geometryOf(t.id);
    grow(t.x - g.width / 2, t.y - g.height / 2, g.width, g.height);
  }
  for (const z of Object.values(seating.zones)) grow(z.x, z.y, z.width, z.height);

  // An empty plan still needs a page to print on.
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1200, h: 900 };
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** A guest called "Smith & Sons" must not close the document. */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** The names of guests, for a "find my seat" list. Nothing else about them. */
export function seatLookupRows(
  guests: Record<string, Guest>,
  seating: Seating,
): Array<{ name: string; table: string }> {
  const out: Array<{ name: string; table: string }> = [];
  for (const table of Object.values(seating.tables)) {
    for (const id of table.assignedGuestIds) {
      const guest = id === null ? undefined : guests[id];
      if (guest) out.push({ name: guestName(guest), table: table.label });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Type labels, so a report can say "Round" rather than "round". */
export const tableTypeLabel = (type: string): string => getTableType(type).label;
