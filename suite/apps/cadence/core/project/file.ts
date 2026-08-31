import { APP_VERSION, SCHEMA_VERSION } from "../model/defaults";
import type { TimelineDoc } from "../model/types";
import { migrate, type RawDoc } from "./migrate";

export const FILE_EXTENSION = ".cadence.json";

export type ParseResult =
  | { doc: TimelineDoc; fromFuture: boolean; error?: undefined }
  | { error: string; doc?: undefined; fromFuture?: undefined };

export function serialise(doc: TimelineDoc): string {
  return JSON.stringify({ ...doc, schemaVersion: doc.schemaVersion, appVersion: APP_VERSION }, null, 2) + "\n";
}

/**
 * Reads a project file. Returns a readable error rather than throwing — this
 * runs on whatever the user dropped on the window, which is often a text file.
 */
export function parse(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "That file is not valid JSON. Is it a Cadence project file?" };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "That file does not contain a Cadence document." };
  }

  const { raw: migrated, fromFuture } = migrate(raw as RawDoc);
  const problem = validate(migrated);
  if (problem) return { error: problem };

  return { doc: migrated as unknown as TimelineDoc, fromFuture };
}

/** Shape check only. Unknown fields are left alone so a newer file survives. */
function validate(raw: RawDoc): string | null {
  if (typeof raw["schemaVersion"] !== "number") return "This file has no schema version.";

  const day = raw["day"];
  if (typeof day !== "object" || day === null) return "This file has no day settings.";
  for (const field of ["date", "coupleNames", "venueName"]) {
    if (typeof (day as RawDoc)[field] !== "string") return `Day settings are missing ${field}.`;
  }
  for (const field of ["latitude", "longitude", "utcOffsetMin", "curfewMin"]) {
    if (typeof (day as RawDoc)[field] !== "number") return `Day settings are missing ${field}.`;
  }

  const blocks = raw["blocks"];
  if (!Array.isArray(blocks)) return "This file has no blocks.";
  for (const [index, block] of blocks.entries()) {
    if (typeof block !== "object" || block === null) return `Block ${index} is not an object.`;
    const entry = block as RawDoc;
    if (typeof entry["id"] !== "string") return `Block ${index} has no id.`;
    if (typeof entry["label"] !== "string") return `Block ${index} has no label.`;
    if (typeof entry["durationMin"] !== "number") return `Block ${index} has no duration.`;
    if (entry["anchorMin"] !== null && typeof entry["anchorMin"] !== "number") {
      return `Block ${index} has an anchor that is neither a time nor empty.`;
    }
    if (typeof entry["lane"] !== "string") return `Block ${index} has no lane.`;
    if (!Array.isArray(entry["tags"])) return `Block ${index} has no tags list.`;
  }

  if (!Array.isArray(raw["lanes"])) return "This file has no lanes.";
  if (!Array.isArray(raw["tagDetails"])) return "This file has no tag details.";
  if (typeof raw["styles"] !== "object" || raw["styles"] === null) {
    return "This file has no styles.";
  }

  return null;
}

/** `charis-and-jacob` — the couple's names, fit for a filename. May be empty. */
export function slugFor(doc: TimelineDoc): string {
  return doc.day.coupleNames
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `charis-and-jacob.cadence.json`, or a sensible fallback. */
export function suggestedFilename(doc: TimelineDoc): string {
  return `${slugFor(doc) || "cadence-day"}${FILE_EXTENSION}`;
}

export { SCHEMA_VERSION };
