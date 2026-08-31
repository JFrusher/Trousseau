import { APP_VERSION, SCHEMA_VERSION } from "../model/defaults";
import type { BrigadeDoc } from "../model/types";

export const FILE_EXTENSION = ".brigade.json";

export type ParseResult =
  | { doc: BrigadeDoc; fromFuture: boolean; error?: undefined }
  | { error: string; doc?: undefined; fromFuture?: undefined };

export function serialise(doc: BrigadeDoc): string {
  return JSON.stringify({ ...doc, appVersion: APP_VERSION }, null, 2) + "\n";
}

/**
 * Reads a Brigade file. The imported day travels inside it, so a file that has
 * moved between machines opens with the work and the day it hangs off, and
 * nothing to import a second time.
 */
export function parse(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "That file is not valid JSON. Is it a Brigade file?" };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "That file does not contain a Brigade document." };
  }

  const entry = raw as Record<string, unknown>;
  if (typeof entry["schemaVersion"] !== "number") {
    return entry["kind"] === "cadence.day"
      ? { error: "That is a day exported from Cadence. Use Import day rather than Open." }
      : { error: "That file has no schema version." };
  }

  for (const field of ["teams", "people", "jobs"]) {
    if (!Array.isArray(entry[field])) return { error: `That file has no ${field}.` };
  }

  // Unknown fields are left alone, so a file from a newer Brigade survives a
  // load and a save rather than being quietly stripped.
  return {
    doc: { ...(entry as unknown as BrigadeDoc), schemaVersion: SCHEMA_VERSION },
    fromFuture: entry["schemaVersion"] > SCHEMA_VERSION,
  };
}

/** `charis-and-jacob.brigade.json`, or a sensible fallback. */
export function suggestedFilename(doc: BrigadeDoc): string {
  const slug = (doc.day?.coupleNames ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "brigade"}${FILE_EXTENSION}`;
}
