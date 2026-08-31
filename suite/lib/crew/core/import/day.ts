import type { DayBlock, ImportedDay } from "../model/types";

/** The export format Brigade reads. Cadence writes `kind: "cadence.day"`. */
export const DAY_KIND = "cadence.day";
export const DAY_VERSION = 1;

/** A team the file suggests, from the tag details Cadence recorded. */
export interface DayTeam {
  tag: string;
  displayName: string;
  phone: string;
  notes: string;
}

export type DayResult =
  | { day: ImportedDay; teams: DayTeam[]; fromFuture: boolean; error?: undefined }
  | { error: string; day?: undefined; teams?: undefined; fromFuture?: undefined };

type Raw = Record<string, unknown>;

/**
 * Reads a `.day.json` exported by Cadence. Returns a readable error rather
 * than throwing — this runs on whatever the user dropped on the window, which
 * is often the wrong file entirely.
 */
export function parseDay(json: string): DayResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "That file is not valid JSON. Is it a day exported from Cadence?" };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "That file does not contain a day." };
  }

  const entry = raw as Raw;
  if (entry["kind"] !== DAY_KIND) {
    return {
      error:
        entry["schemaVersion"] === undefined
          ? "That file was not exported from Cadence."
          : "That is a Cadence project file. Brigade needs the day export — press Export day in Cadence.",
    };
  }

  const day = entry["day"];
  if (typeof day !== "object" || day === null) return { error: "That day has no settings." };
  const settings = day as Raw;

  for (const field of ["date", "coupleNames", "venueName"]) {
    if (typeof settings[field] !== "string") return { error: `The day is missing ${field}.` };
  }
  for (const field of ["curfewMin", "utcOffsetMin"]) {
    if (typeof settings[field] !== "number") return { error: `The day is missing ${field}.` };
  }

  const rawBlocks = entry["blocks"];
  if (!Array.isArray(rawBlocks)) return { error: "That day has no blocks." };

  const blocks: DayBlock[] = [];
  for (const [index, candidate] of rawBlocks.entries()) {
    const block = asObject(candidate);
    if (!block) return { error: `Block ${index} is not an object.` };

    for (const field of ["id", "label", "lane"]) {
      if (typeof block[field] !== "string") return { error: `Block ${index} has no ${field}.` };
    }
    for (const field of ["startMin", "endMin"]) {
      if (typeof block[field] !== "number") return { error: `Block ${index} has no ${field}.` };
    }

    const startMin = block["startMin"] as number;
    blocks.push({
      id: block["id"] as string,
      label: block["label"] as string,
      lane: block["lane"] as string,
      location: text(block["location"]),
      notes: text(block["notes"]),
      tags: Array.isArray(block["tags"]) ? block["tags"].filter(isString) : [],
      startMin,
      contentEndMin: typeof block["contentEndMin"] === "number" ? block["contentEndMin"] : startMin,
      endMin: block["endMin"] as number,
      anchored: block["anchored"] === true,
      moment: block["moment"] === true,
    });
  }

  const version = typeof entry["version"] === "number" ? entry["version"] : 0;

  return {
    day: {
      version,
      appVersion: text(entry["appVersion"]) || "unknown",
      date: settings["date"] as string,
      coupleNames: settings["coupleNames"] as string,
      venueName: settings["venueName"] as string,
      curfewMin: settings["curfewMin"] as number,
      utcOffsetMin: settings["utcOffsetMin"] as number,
      lanes: Array.isArray(entry["lanes"]) ? entry["lanes"].filter(isString) : [],
      blocks,
    },
    teams: teamsIn(entry["teams"]),
    // A newer Cadence is read as far as this version understands it rather
    // than refused: the fields Brigade needs have not moved.
    fromFuture: version > DAY_VERSION,
  };
}

function teamsIn(value: unknown): DayTeam[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    const team = asObject(candidate);
    if (!team || typeof team["tag"] !== "string") return [];
    return [
      {
        tag: team["tag"],
        displayName: text(team["displayName"]),
        phone: text(team["phone"]),
        notes: text(team["notes"]),
      },
    ];
  });
}

function asObject(value: unknown): Raw | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
