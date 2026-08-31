import { SCHEMA_VERSION } from "../model/defaults";

/** A document as read off disk, before it is known to be valid. */
export type RawDoc = Record<string, unknown>;

type Step = (raw: RawDoc) => RawDoc;

/**
 * Keyed on the version being upgraded FROM. Version 1 is the first, so this is
 * empty; the machinery is here because the first migration is always written
 * in a hurry.
 */
const STEPS: Record<number, Step> = {};

export interface MigrateResult {
  raw: RawDoc;
  /** True when the file came from a newer Cadence than this one. */
  fromFuture: boolean;
}

/**
 * Brings a document up to the current schema. A file from a future version is
 * passed through untouched rather than mangled — unknown fields survive a load
 * and save, so an older Cadence cannot quietly eat a newer one's data.
 */
export function migrate(raw: RawDoc): MigrateResult {
  const version = typeof raw["schemaVersion"] === "number" ? (raw["schemaVersion"] as number) : 0;
  if (version > SCHEMA_VERSION) return { raw, fromFuture: true };

  // Fields added after a document was written default rather than fail validation.
  let current: RawDoc = Array.isArray(raw["fonts"]) ? raw : { ...raw, fonts: [] };
  for (let from = version; from < SCHEMA_VERSION; from += 1) {
    const step = STEPS[from];
    if (!step) break;
    current = step(current);
  }
  return { raw: { ...current, schemaVersion: SCHEMA_VERSION }, fromFuture: false };
}
