import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import { DEFAULT_FONT_ID } from "./assets/fonts";
import type { GuestRow } from "./csv/parse";
import { defaultCard, defaultSheet, defaultTemplate } from "./template/defaults";
import type { PrinterProfile } from "./print/printerProfile";
import type { CardSpec, RowScope, SheetSpec, Template } from "./types";

/**
 * The `stationery` slice: the card, the sheet it is imposed on, the design, and
 * the printer it is going to.
 *
 * Plaque's own document, minus its guest list — because the suite already has
 * one, and holding a second copy here is exactly the disagreement this
 * application exists to end. Rows come from the seating plan by default and
 * from an uploaded CSV only when the plan cannot answer the question.
 */

export type RowSource = "plan" | "csv";

export interface Stationery {
  card: CardSpec;
  sheet: SheetSpec;
  template: Template;
  printer: PrinterProfile;
  rowScope: RowScope;
  /** Where the rows come from. The plan, unless the user chose otherwise. */
  rowSource: RowSource;
  /** Uploaded CSV, kept so a design survives a reload without re-uploading. */
  csv: { headers: string[]; rows: GuestRow[]; fileName: string | null } | null;
  /** Uploaded font ids to the family name they were given. Bytes are in IndexedDB. */
  fonts: Record<string, string>;
  /** Uploaded image and icon ids to their original filename, for missing-asset reports. */
  assetNames: Record<string, string>;
  /** Uploaded SVG icons: icon id to path data. Small enough to live in the document. */
  uploadedIcons: Record<string, string>;
}

/**
 * A printer assumed to be telling the truth until measured.
 *
 * Scale 1 and no offsets: nothing is compensated for until the user has printed
 * the calibration sheet and read a real number off it. Guessing a correction
 * would be worse than none, because it would be wrong in an unknown direction.
 */
export function honestPrinter(): PrinterProfile {
  return {
    id: "default",
    name: "This printer",
    scale: 1,
    measuredMm: null,
    calibratedAt: null,
    flipEdge: "long",
    backOffsetXMm: 0,
    backOffsetYMm: 0,
    unprintableMarginMm: null,
  };
}

export function emptyStationery(): Stationery {
  return {
    card: defaultCard(),
    sheet: defaultSheet(),
    template: defaultTemplate([...PLAN_HEADERS]),
    printer: honestPrinter(),
    rowScope: { kind: "per-row" },
    rowSource: "plan",
    csv: null,
    fonts: {},
    assetNames: {},
    uploadedIcons: {},
  };
}

/**
 * The columns the seating plan can answer.
 *
 * Named as a CSV would name them, so a design written against an uploaded list
 * keeps working when the source is switched to the plan — and so Plaque's own
 * header guessing recognises them without a special case.
 */
export const PLAN_HEADERS = [
  "First Name",
  "Last Name",
  "Table",
  "Seat",
  "Dietary",
  "Entree",
  "Side",
  "Group",
  "Family",
  "Notes",
] as const;

const SIDE_LABEL: Record<string, string> = {
  bride: "Bride's",
  groom: "Groom's",
  both: "Both",
};

/**
 * The seating plan, as rows a card design can bind to.
 *
 * Ordered by table then by seat, because place cards are printed to be dealt
 * out table by table. This is the join the whole suite exists for: move
 * somebody in the room and their card follows, with no export in between.
 */
export function planRows(
  guests: Record<string, Guest>,
  seating: Seating,
  options: { includeUnseated?: boolean } = {},
): { headers: string[]; rows: GuestRow[]; ids: string[] } {
  const rows: GuestRow[] = [];
  const ids: string[] = [];
  const placed = new Set<string>();

  const tables = Object.values(seating.tables).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );

  const rowFor = (guest: Guest, table: string, seat: string): GuestRow => ({
    "First Name": guest.firstName,
    "Last Name": guest.lastName,
    Table: table,
    Seat: seat,
    Dietary: guest.dietary,
    Entree: guest.entree,
    Side: SIDE_LABEL[guest.side] ?? "",
    Group: seating.groups[guest.groupId ?? ""]?.name ?? "",
    Family: seating.families[guest.familyId ?? ""]?.name ?? "",
    Notes: guest.notes,
  });

  for (const table of tables) {
    table.assignedGuestIds.forEach((id, index) => {
      const guest = id === null ? undefined : guests[id];
      if (!guest || placed.has(guest.id)) return;
      placed.add(guest.id);
      rows.push(rowFor(guest, table.label, table.seatMode === "seat" ? String(index + 1) : ""));
      // The guest's own id, so a per-row design override survives a reseat.
      ids.push(guest.id);
    });
  }

  if (options.includeUnseated) {
    const rest = Object.values(guests)
      .filter((g) => !placed.has(g.id))
      .sort(
        (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
      );
    for (const guest of rest) {
      rows.push(rowFor(guest, "", ""));
      ids.push(guest.id);
    }
  }

  return { headers: [...PLAN_HEADERS], rows, ids };
}

/** A printable name for a row, for the pagination readout and warning messages. */
export function rowLabel(row: GuestRow): string {
  const name = `${row["First Name"] ?? ""} ${row["Last Name"] ?? ""}`.trim();
  return name || Object.values(row).find(Boolean) || "(blank)";
}

/** The same, from a guest — used where the plan is the source. */
export const labelOfGuest = guestName;

/**
 * Cached per raw slice object, exactly like the readers in `model/slices`.
 *
 * Coercion allocates, and a selector that allocates returns a new reference on
 * every render — which under `useSyncExternalStore` is an infinite update loop,
 * not merely a slow render. The key is the stored slice itself, so the work is
 * done once per document rather than once per read.
 */
const cache = new WeakMap<object, Stationery>();

/** Total coercion, like every other slice reader. A half-written design still opens. */
export function readStationery(raw: unknown): Stationery {
  if (typeof raw === "object" && raw !== null) {
    const hit = cache.get(raw);
    if (hit) return hit;
  }
  const built = coerceStationery(raw);
  if (typeof raw === "object" && raw !== null) cache.set(raw, built);
  return built;
}

function coerceStationery(raw: unknown): Stationery {
  const base = emptyStationery();
  if (typeof raw !== "object" || raw === null) return base;
  const s = raw as Record<string, unknown>;

  const object = <T,>(value: unknown, fallback: T): T =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : fallback;

  const template = object<Template>(s["template"], base.template);

  return {
    card: { ...base.card, ...object<CardSpec>(s["card"], base.card) },
    sheet: { ...base.sheet, ...object<SheetSpec>(s["sheet"], base.sheet) },
    template: Array.isArray(template.elements) ? template : base.template,
    printer: { ...base.printer, ...object<PrinterProfile>(s["printer"], base.printer) },
    rowScope: object<RowScope>(s["rowScope"], base.rowScope),
    rowSource: s["rowSource"] === "csv" ? "csv" : "plan",
    csv: object<Stationery["csv"]>(s["csv"], null),
    fonts: object<Record<string, string>>(s["fonts"], {}),
    assetNames: object<Record<string, string>>(s["assetNames"], {}),
    uploadedIcons: object<Record<string, string>>(s["uploadedIcons"], {}),
  };
}

export { DEFAULT_FONT_ID };
