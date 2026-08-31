import type { Trousseau } from "@jfrusher/trousseau";
import { resolve } from "@/apps/cadence/core/schedule/resolve";
import { resolvedDay as resolveDaySlice } from "@/apps/cadence/core/project/day";
import {
  DEFAULT_BLOCK_OUTPUTS,
  DEFAULT_LANES,
  DEFAULT_OUTPUTS,
  defaultDay,
  defaultStyles,
  emptyDoc,
} from "@/apps/cadence/core/model/defaults";
import type {
  Constraint,
  Crew,
  CustomTablePreset,
  Designation,
  Family,
  Guest,
  NamedGroup,
  Obstacle,
  PerSideSeats,
  RoomSpec,
  Seating,
  SeatingSettings,
  Snapshot,
  Space,
  Table,
  Zone,
} from "./types";
import type { OutputSpec, Timeline, TimelineDoc } from "./timeline";

/**
 * Typed views onto the envelope's slices.
 *
 * A slice arrives as `unknown` — the contract package validates the envelope
 * and stops at the slice boundary on purpose. So every read coerces, and every
 * coercion is total: a missing or malformed slice becomes an empty one rather
 * than throwing, because a half-filled wedding is the normal state of a wedding
 * and not a validation failure.
 *
 * Results are cached per document object. Coercion allocates, and a selector
 * that allocates returns a new reference on every render — with zustand v5 on
 * `useSyncExternalStore` that is an infinite loop, not merely a slow render.
 */
const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * Anything a store selector calls must go through this.
 *
 * A selector that allocates returns a new reference on every render, which
 * under `useSyncExternalStore` is an infinite update loop — React error #185 —
 * not merely a slow render. `lib/model/selectors.test.ts` asserts referential
 * stability for every derived view; add new ones to it.
 */

export function cached<T>(doc: Trousseau, key: string, build: () => T): T {
  let slot = cache.get(doc);
  if (!slot) {
    slot = new Map();
    cache.set(doc, slot);
  }
  if (!slot.has(key)) slot.set(key, build());
  return slot.get(key) as T;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function list<T>(v: unknown, of: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    const kept = of(item);
    if (kept !== null) out.push(kept);
  }
  return out;
}

// guests ---------------------------------------------------------------------

export function readGuests(doc: Trousseau): Record<string, Guest> {
  return cached(doc, "guests", () => coerceGuests(doc.guests));
}

/**
 * Guests from any raw source — the slice, or a snapshot taken months ago.
 *
 * Separate from `readGuests` because a snapshot is stored data too, and casting
 * it back to `Guest` instead of coercing it would let a half-formed record from
 * an older version through with fields the rest of the app assumes are there.
 */
export function coerceGuests(source: unknown): Record<string, Guest> {
  const out: Record<string, Guest> = {};
  for (const [id, raw] of Object.entries(isRecord(source) ? source : {})) {
    if (!isRecord(raw)) continue;
    const rsvp = raw["rsvpStatus"];
    const side = raw["side"];
    out[id] = {
      id: str(raw["id"], id),
      firstName: str(raw["firstName"]),
      lastName: str(raw["lastName"]),
      email: str(raw["email"]),
      rsvpStatus: rsvp === "confirmed" || rsvp === "declined" ? rsvp : "pending",
      dietary: str(raw["dietary"]),
      entree: str(raw["entree"]),
      notes: str(raw["notes"]),
      side: side === "bride" || side === "groom" || side === "both" ? side : "",
      groupId: typeof raw["groupId"] === "string" ? raw["groupId"] : null,
      subgroupId: typeof raw["subgroupId"] === "string" ? raw["subgroupId"] : null,
      familyId: typeof raw["familyId"] === "string" ? raw["familyId"] : null,
      assignedTableId:
          typeof raw["assignedTableId"] === "string" ? raw["assignedTableId"] : null,
      tags: list(raw["tags"], (t) => (typeof t === "string" ? t : null)),
      plusOneOf: typeof raw["plusOneOf"] === "string" ? raw["plusOneOf"] : null,
    };
  }
  return out;
}

/** A guest's printed name. `firstName` may hold a whole name on a one-column import. */
export function guestName(guest: Guest): string {
  return [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim();
}

// seating --------------------------------------------------------------------

/**
 * Pixels per centimetre. Locked: changing it would rescale every stored layout,
 * so a plan authored at this scale must always be read back at it.
 */
export const DEFAULT_PPU = 0.7;

/** Standard banquet chair footprint, in centimetres. */
export const DEFAULT_CHAIR_CM = 45;

/** What a table can be marked as. Anything else read from a file becomes null. */
const DESIGNATIONS = new Set(["top-table", "vip", "kids", "band-bar"]);

export function emptyRoom(): RoomSpec {
  return {
    widthUnits: Math.round(1200 / DEFAULT_PPU),
    heightUnits: Math.round(900 / DEFAULT_PPU),
    width: 1200,
    height: 900,
    backgroundColour: "#FAF8F5",
    spaces: [
      {
        id: "space_main",
        label: "Room",
        shape: "rect",
        x: 0,
        y: 0,
        width: 1200,
        height: 900,
        backgroundColour: "#FAF8F5",
      },
    ],
  };
}

export function emptySeatingSettings(): SeatingSettings {
  return {
    defaultSeatMode: "table",
    pixelsPerUnit: DEFAULT_PPU,
    gridSnap: true,
    gridSize: 20,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: DEFAULT_CHAIR_CM,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  };
}

export function emptySeating(): Seating {
  return {
    tables: {},
    groups: {},
    subgroups: {},
    families: {},
    zones: {},
    obstacles: {},
    constraints: [],
    snapshots: [],
    room: emptyRoom(),
    settings: emptySeatingSettings(),
  };
}

export function readSeating(doc: Trousseau): Seating {
  return cached(doc, "seating", () => {
    const raw: Record<string, unknown> = isRecord(doc.seating) ? doc.seating : {};
    const settings = isRecord(raw["settings"]) ? raw["settings"] : {};
    const room = isRecord(raw["room"]) ? raw["room"] : {};
    const base = emptyRoom();

    const tables: Record<string, Table> = {};
    if (isRecord(raw["tables"])) {
      for (const [id, t] of Object.entries(raw["tables"])) {
        if (!isRecord(t)) continue;
        const table: Table = {
          id: str(t["id"], id),
          label: str(t["label"], id),
          type: str(t["type"], "round"),
          capacity: num(t["capacity"], 8),
          x: num(t["x"], 0),
          y: num(t["y"], 0),
          rotation: num(t["rotation"], 0),
          seatMode: t["seatMode"] === "seat" ? "seat" : "table",
          assignedGuestIds: Array.isArray(t["assignedGuestIds"])
            ? t["assignedGuestIds"].map((g) => (typeof g === "string" ? g : null))
            : [],
          designation: DESIGNATIONS.has(t["designation"] as string)
            ? (t["designation"] as Designation)
            : null,
          colour: typeof t["colour"] === "string" ? t["colour"] : null,
        };
        if (isRecord(t["sizeUnits"])) table.sizeUnits = t["sizeUnits"] as Table["sizeUnits"];
        if (isRecord(t["perSideSeats"])) table.perSideSeats = perSide(t["perSideSeats"]);
        if (isRecord(t["seatArcRange"])) {
          table.seatArcRange = t["seatArcRange"] as Table["seatArcRange"];
        }
        tables[id] = table;
      }
    }

    const width = num(room["width"], base.width);
    const height = num(room["height"], base.height);
    const backgroundColour = str(room["backgroundColour"], base.backgroundColour);
    const spaces = list(room["spaces"], readSpace);

    return {
      tables,
      groups: namedGroups(raw["groups"]),
      subgroups: namedGroups(raw["subgroups"]),
      families: readFamilies(raw["families"]),
      zones: readZones(raw["zones"]),
      obstacles: readObstacles(raw["obstacles"]),
      constraints: readConstraints(raw["constraints"]),
      snapshots: list(raw["snapshots"], (sn) => {
        if (!isRecord(sn) || typeof sn["id"] !== "string") return null;
        return {
          id: sn["id"],
          label: str(sn["label"], "Snapshot"),
          at: str(sn["at"]),
          seating: sn["seating"] ?? {},
          guests: sn["guests"] ?? {},
        } satisfies Snapshot;
      }),
      room: {
        widthUnits: num(room["widthUnits"], base.widthUnits),
        heightUnits: num(room["heightUnits"], base.heightUnits),
        width,
        height,
        backgroundColour,
        // A plan authored before multi-room support has no spaces. Its single
        // rectangle becomes the first one, so the canvas has floor to draw.
        spaces:
          spaces.length > 0
            ? spaces
            : [
                {
                  id: "space_main",
                  label: "Room",
                  shape: "rect",
                  x: 0,
                  y: 0,
                  width,
                  height,
                  backgroundColour,
                },
              ],
      },
      settings: {
        defaultSeatMode: settings["defaultSeatMode"] === "seat" ? "seat" : "table",
        pixelsPerUnit: num(settings["pixelsPerUnit"], DEFAULT_PPU),
        gridSnap: bool(settings["gridSnap"], true),
        gridSize: num(settings["gridSize"], 20),
        snapAlign: bool(settings["snapAlign"], true),
        showChairs: bool(settings["showChairs"], true),
        chairSizeUnits: num(settings["chairSizeUnits"], DEFAULT_CHAIR_CM),
        showDietaryBadges: bool(settings["showDietaryBadges"], true),
        showGroupColours: bool(settings["showGroupColours"], true),
        unitSystem: settings["unitSystem"] === "imperial" ? "imperial" : "metric",
        customTablePresets: list(settings["customTablePresets"], (p) => {
          if (!isRecord(p) || typeof p["id"] !== "string") return null;
          return {
            id: p["id"],
            label: str(p["label"], "Custom"),
            widthUnits: num(p["widthUnits"], 180),
            heightUnits: num(p["heightUnits"], 90),
            perSideSeats: perSide(p["perSideSeats"]),
          } satisfies CustomTablePreset;
        }),
      },
    };
  });
}

function perSide(raw: unknown): PerSideSeats {
  const v = isRecord(raw) ? raw : {};
  const edge = (k: string) => Math.max(0, Math.min(40, Math.round(num(v[k], 0))));
  return { top: edge("top"), bottom: edge("bottom"), left: edge("left"), right: edge("right") };
}

function readSpace(raw: unknown): Space | null {
  if (!isRecord(raw) || typeof raw["id"] !== "string") return null;
  const common = {
    id: raw["id"],
    label: str(raw["label"], "Space"),
    x: num(raw["x"], 0),
    y: num(raw["y"], 0),
    backgroundColour: str(raw["backgroundColour"], "#FAF8F5"),
  };
  if (raw["shape"] === "polygon") {
    return {
      ...common,
      shape: "polygon",
      vertices: list(raw["vertices"], (v) =>
        isRecord(v) ? { x: num(v["x"], 0), y: num(v["y"], 0) } : null,
      ),
    };
  }
  return {
    ...common,
    shape: "rect",
    width: num(raw["width"], 400),
    height: num(raw["height"], 300),
  };
}

function readZones(raw: unknown): Record<string, Zone> {
  const out: Record<string, Zone> = {};
  if (!isRecord(raw)) return out;
  for (const [id, z] of Object.entries(raw)) {
    if (!isRecord(z)) continue;
    out[id] = {
      id: str(z["id"], id),
      label: str(z["label"], "Zone"),
      x: num(z["x"], 0),
      y: num(z["y"], 0),
      width: num(z["width"], 200),
      height: num(z["height"], 120),
      colour: str(z["colour"], "#849E86"),
    };
  }
  return out;
}

function readObstacles(raw: unknown): Record<string, Obstacle> {
  const out: Record<string, Obstacle> = {};
  if (!isRecord(raw)) return out;
  for (const [id, o] of Object.entries(raw)) {
    if (!isRecord(o)) continue;
    out[id] = {
      id: str(o["id"], id),
      kind: o["kind"] === "pillar" ? "pillar" : "wall",
      x: num(o["x"], 0),
      y: num(o["y"], 0),
      width: num(o["width"], 200),
      height: num(o["height"], 12),
      rotation: num(o["rotation"], 0),
    };
  }
  return out;
}

/** A rule naming fewer than two guests is not a rule, so it is dropped. */
function readConstraints(raw: unknown): Constraint[] {
  return list(raw, (c) => {
    if (!isRecord(c) || typeof c["id"] !== "string") return null;
    const ids = list(c["guestIds"], (g) => (typeof g === "string" ? g : null));
    if (ids.length < 2 || ids[0] === undefined || ids[1] === undefined) return null;
    return {
      id: c["id"],
      kind: c["kind"] === "together" ? "together" : "apart",
      guestIds: [ids[0], ids[1]],
      note: str(c["note"]),
    } satisfies Constraint;
  });
}

function readFamilies(raw: unknown): Record<string, Family> {
  const out: Record<string, Family> = {};
  if (!isRecord(raw)) return out;
  for (const [id, f] of Object.entries(raw)) {
    if (!isRecord(f)) continue;
    const family: Family = {
      id: str(f["id"], id),
      name: str(f["name"], id),
      memberIds: list(f["memberIds"], (m) => (typeof m === "string" ? m : null)),
    };
    if (typeof f["colour"] === "string") family.colour = f["colour"];
    out[id] = family;
  }
  return out;
}

function namedGroups(raw: unknown): Record<string, NamedGroup> {
  const out: Record<string, NamedGroup> = {};
  if (!isRecord(raw)) return out;
  for (const [id, g] of Object.entries(raw)) {
    if (!isRecord(g)) continue;
    const group: NamedGroup = { id: str(g["id"], id), name: str(g["name"], id) };
    if (typeof g["colour"] === "string") group.colour = g["colour"];
    out[id] = group;
  }
  return out;
}

// timeline -------------------------------------------------------------------

export { DEFAULT_LANES };

/**
 * The timeline, as Cadence's own document.
 *
 * The stored slice is coerced into a complete `TimelineDoc`, and `day` is
 * overwritten from the envelope's `event` on every read. Cadence keeps the
 * couple's details inside its own document; the envelope is where they are
 * authoritative, so this is the one place the echo is made, rather than two
 * places that can disagree about the date of the wedding.
 */
export function readTimeline(doc: Trousseau): Timeline {
  return cached(doc, "timeline", () => {
    const base = emptyDoc();
    const raw: Record<string, unknown> = isRecord((doc as Record<string, unknown>)["timeline"])
      ? ((doc as Record<string, unknown>)["timeline"] as Record<string, unknown>)
      : {};

    const lanes = list(raw["lanes"], (l) => (typeof l === "string" ? l : null));
    const laneNames = lanes.length > 0 ? lanes : [...DEFAULT_LANES];
    const firstLane = laneNames[0] ?? "Main day";
    const storedDay = isRecord(raw["day"]) ? raw["day"] : {};
    const fallbackDay = defaultDay();

    return {
      schemaVersion: base.schemaVersion,
      appVersion: base.appVersion,
      day: {
        // From the envelope, which owns these. Cadence's copy is an echo.
        date: doc.event.date || str(storedDay["date"], fallbackDay.date),
        coupleNames: doc.event.coupleNames || str(storedDay["coupleNames"]),
        venueName: doc.event.venueName || str(storedDay["venueName"]),
        curfewMin: doc.event.curfewMin ?? num(storedDay["curfewMin"], fallbackDay.curfewMin),
        utcOffsetMin:
          doc.event.utcOffsetMin ?? num(storedDay["utcOffsetMin"], fallbackDay.utcOffsetMin),
        // The venue's coordinates are Cadence's alone: nothing else needs them,
        // and they drive only the golden-hour advisory.
        latitude: num(storedDay["latitude"], fallbackDay.latitude),
        longitude: num(storedDay["longitude"], fallbackDay.longitude),
        logoKey: typeof storedDay["logoKey"] === "string" ? storedDay["logoKey"] : null,
      },
      lanes: laneNames,
      blocks: list(raw["blocks"], (b) => {
        if (!isRecord(b) || typeof b["id"] !== "string") return null;
        return {
          id: b["id"],
          label: str(b["label"], "Untitled"),
          durationMin: num(b["durationMin"], 0),
          anchorMin: typeof b["anchorMin"] === "number" ? b["anchorMin"] : null,
          gapMin: num(b["gapMin"], 0),
          bufferMin: num(b["bufferMin"], 0),
          squeezeToMin: typeof b["squeezeToMin"] === "number" ? b["squeezeToMin"] : null,
          lane: str(b["lane"], firstLane),
          tags: list(b["tags"], (t) => (typeof t === "string" ? t : null)),
          location: str(b["location"]),
          notes: str(b["notes"]),
          outputs: list(b["outputs"], (o) =>
            o === "run-sheet" || o === "call-sheet" || o === "order-of-day" || o === "contact-sheet"
              ? o
              : null,
          ),
        };
      }),
      tagDetails: list(raw["tagDetails"], (t) => {
        if (!isRecord(t) || typeof t["tag"] !== "string") return null;
        return {
          tag: t["tag"],
          displayName: str(t["displayName"]),
          phone: str(t["phone"]),
          arrivalMin: typeof t["arrivalMin"] === "number" ? t["arrivalMin"] : null,
          notes: str(t["notes"]),
        };
      }),
      outputs: readOutputs(raw["outputs"]),
      styles: isRecord(raw["styles"])
        ? { ...defaultStyles(), ...(raw["styles"] as ReturnType<typeof defaultStyles>) }
        : defaultStyles(),
      fonts: list(raw["fonts"], (f) => {
        if (!isRecord(f) || typeof f["family"] !== "string") return null;
        return { family: f["family"], blobKey: str(f["blobKey"]) };
      }),
    };
  });
}

export { DEFAULT_BLOCK_OUTPUTS };

/**
 * The printed pieces a document asks for.
 *
 * The set is fixed — each one has its own renderer — so an id nothing can draw
 * is dropped rather than carried, and a document naming none of them gets the
 * standard four rather than nothing to print.
 */
function readOutputs(raw: unknown): OutputSpec[] {
  const found = list(raw, (o) => {
    if (!isRecord(o)) return null;
    const known = DEFAULT_OUTPUTS.find((d) => d.id === o["id"]);
    if (!known) return null;
    return {
      id: known.id,
      label: str(o["label"], known.label),
      pageSize: o["pageSize"] === "A5" ? ("A5" as const) : ("A4" as const),
    };
  });
  return found.length > 0 ? found : DEFAULT_OUTPUTS;
}

/** The document the resolver and the clash checks read. Now the same object. */
export function timelineDoc(doc: Trousseau): TimelineDoc {
  return readTimeline(doc);
}

/** The resolved day, memoised per document, so a render never re-runs it. */
export function resolvedDay(doc: Trousseau) {
  return cached(doc, "resolved", () => resolve(readTimeline(doc)));
}

/**
 * The `day` slice: the timeline with every clock time worked out.
 *
 * Published rather than derived on demand, because it is what leaves the
 * machine. An exported document with no `day` is one no outside reader — the
 * cross-slice validator included — can check the timeline of. Built by
 * Cadence's own publisher, so what the suite writes is byte-for-byte what
 * Cadence would have written.
 */
export function publishDay(doc: Trousseau, timeline: Timeline): Record<string, unknown> {
  return resolveDaySlice({
    ...timeline,
    day: {
      ...timeline.day,
      date: doc.event.date || timeline.day.date,
      coupleNames: doc.event.coupleNames || timeline.day.coupleNames,
      venueName: doc.event.venueName || timeline.day.venueName,
      curfewMin: doc.event.curfewMin ?? timeline.day.curfewMin,
      utcOffsetMin: doc.event.utcOffsetMin ?? timeline.day.utcOffsetMin,
    },
  }) as unknown as Record<string, unknown>;
}

// crew -----------------------------------------------------------------------

export function readCrew(doc: Trousseau): Crew {
  return cached(doc, "crew", () => {
    const raw: Record<string, unknown> = isRecord(doc.crew) ? doc.crew : {};
    return {
      teams: list(raw["teams"], (t) => {
        if (!isRecord(t) || typeof t["id"] !== "string") return null;
        return {
          id: t["id"],
          tag: typeof t["tag"] === "string" ? t["tag"] : null,
          name: str(t["name"], "Team"),
          phone: str(t["phone"]),
          notes: str(t["notes"]),
        };
      }),
      people: list(raw["people"], (p) => {
        if (!isRecord(p) || typeof p["id"] !== "string") return null;
        return {
          id: p["id"],
          name: str(p["name"], "Someone"),
          teamId: typeof p["teamId"] === "string" ? p["teamId"] : null,
          phone: str(p["phone"]),
          notes: str(p["notes"]),
          // Which guest this person is, when they are one. Narrowing this away
          // would quietly unlink every crew member on the next read.
          guestId: typeof p["guestId"] === "string" ? p["guestId"] : null,
        };
      }),
      jobs: list(raw["jobs"], (j) => {
        if (!isRecord(j) || typeof j["id"] !== "string") return null;
        const status = j["status"];
        return {
          id: j["id"],
          blockId: str(j["blockId"]),
          label: str(j["label"], "Job"),
          notes: str(j["notes"]),
          teamId: typeof j["teamId"] === "string" ? j["teamId"] : null,
          personIds: list(j["personIds"], (p) => (typeof p === "string" ? p : null)),
          status: status === "doing" || status === "done" ? status : "todo",
        };
      }),
    };
  });
}
