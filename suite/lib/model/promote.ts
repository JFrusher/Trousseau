/**
 * Fills empty slices from a collected document's `sources`.
 *
 * There are two shapes of Trousseau file in the world. One has the wedding in
 * its slices, which is what the tools read. The other is what the collector
 * writes: each tool's own export filed under `sources`, with the slices left
 * empty. Both are valid, both are called `.trousseau.json`, and both pass the
 * validator — so the second one restores without error and produces an empty
 * app under a message saying it worked. That is a trap, and the fix is for the
 * app to accept either rather than for anyone to remember which is which.
 *
 * Only ever fills a slice that is empty. A collected export is a snapshot of
 * what a tool had when it was collected, so it must never be allowed to
 * overwrite a slice that has since been edited — on a document holding both,
 * the slice is the newer answer.
 */

/** The keys Tableaux keeps outside its guest list. Mirrors the app's own split. */
const SEATING_KEYS = [
  "meta",
  "groups",
  "subgroups",
  "families",
  "tables",
  "zones",
  "room",
  "wallElements",
  "pillars",
  "canvas",
  "snapshots",
  "constraints",
  "settings",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const empty = (value: unknown): boolean =>
  !isRecord(value) || Object.keys(value).length === 0;

export interface Promotion {
  raw: Record<string, unknown>;
  /** What was filled in, for telling the user. Empty when nothing needed doing. */
  filled: string[];
}

export function promoteSources(input: unknown): Promotion {
  if (!isRecord(input)) return { raw: {}, filled: [] };

  const raw = { ...input };
  const sources = isRecord(raw["sources"]) ? raw["sources"] : {};
  const filled: string[] = [];

  // ── The room and the guest list ────────────────────────────────────────
  const tableaux = isRecord(sources["tableaux"]) ? sources["tableaux"] : null;

  if (tableaux) {
    if (empty(raw["guests"]) && isRecord(tableaux["guests"])) {
      raw["guests"] = tableaux["guests"];
      filled.push(`${Object.keys(tableaux["guests"]).length} guests`);
    }

    if (empty(raw["seating"])) {
      const seating: Record<string, unknown> = {};
      for (const key of SEATING_KEYS) {
        if (tableaux[key] !== undefined) seating[key] = tableaux[key];
      }
      if (Object.keys(seating).length > 0) {
        raw["seating"] = seating;
        const tables = isRecord(seating["tables"]) ? Object.keys(seating["tables"]).length : 0;
        filled.push(`${tables} tables`);
      }
    }
  }

  // ── The day ────────────────────────────────────────────────────────────
  const published = isRecord(raw["day"]) ? raw["day"] : null;
  const blocks = published && Array.isArray(published["blocks"]) ? published["blocks"] : [];
  const timeline = isRecord(raw["timeline"]) ? raw["timeline"] : null;
  const hasTimeline = timeline !== null && Array.isArray(timeline["blocks"]) && timeline["blocks"].length > 0;

  if (!hasTimeline && blocks.length > 0) {
    raw["timeline"] = rebuildTimeline(raw, published as Record<string, unknown>, blocks);
    filled.push(`${blocks.length} parts of the day`);
  }

  return { raw, filled };
}

/**
 * Rebuilds an editable timeline from the published day.
 *
 * The day records what the times came out as. What produced them — which block
 * was anchored, which followed after a gap — was never part of it, and cannot
 * be worked back out. So every block is pinned to the time it already has,
 * which reproduces the same day exactly.
 *
 * The cost is that it will not ripple: moving one block leaves the rest where
 * they are until its anchor is cleared. That is the honest outcome of the
 * information not being there, and it is better than guessing at a structure
 * and quietly moving somebody's ceremony.
 */
function rebuildTimeline(
  raw: Record<string, unknown>,
  published: Record<string, unknown>,
  blocks: unknown[],
): Record<string, unknown> {
  const event = isRecord(raw["event"]) ? raw["event"] : {};
  const settings = isRecord(published["day"]) ? published["day"] : {};
  const str = (a: unknown, b: unknown, fallback = "") =>
    typeof a === "string" && a !== "" ? a : typeof b === "string" ? b : fallback;
  const num = (a: unknown, b: unknown, fallback: number) =>
    typeof a === "number" ? a : typeof b === "number" ? b : fallback;

  const lanes = Array.isArray(published["lanes"])
    ? published["lanes"].filter((lane): lane is string => typeof lane === "string")
    : [];

  return {
    schemaVersion: 1,
    appVersion: typeof published["appVersion"] === "string" ? published["appVersion"] : "0.1.0",
    day: {
      // The envelope owns these; the day keeps an echo of them.
      date: str(event["date"], settings["date"]),
      coupleNames: str(event["coupleNames"], settings["coupleNames"]),
      venueName: str(event["venueName"], settings["venueName"]),
      curfewMin: num(event["curfewMin"], settings["curfewMin"], 1500),
      utcOffsetMin: num(event["utcOffsetMin"], settings["utcOffsetMin"], 0),
      latitude: num(settings["latitude"], undefined, 51.5),
      longitude: num(settings["longitude"], undefined, -0.12),
      logoKey: typeof settings["logoKey"] === "string" ? settings["logoKey"] : null,
    },
    lanes: lanes.length > 0 ? lanes : ["Main day"],
    blocks: blocks.filter(isRecord).map((block) => {
      const start = num(block["startMin"], undefined, 0);
      const end = num(block["endMin"], undefined, start);
      return {
        id: String(block["id"] ?? ""),
        label: str(block["label"], undefined, "Untitled"),
        durationMin: Math.max(0, end - start),
        anchorMin: start,
        gapMin: 0,
        bufferMin: 0,
        squeezeToMin: null,
        lane: str(block["lane"], undefined, lanes[0] ?? "Main day"),
        tags: Array.isArray(block["tags"]) ? block["tags"].map(String) : [],
        location: str(block["location"], undefined),
        notes: str(block["notes"], undefined),
        outputs: ["run-sheet"],
      };
    }),
    tagDetails: [],
    fonts: [],
    styles: {},
    outputs: {},
  };
}
