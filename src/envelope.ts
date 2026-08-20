import { z } from "zod";
import { daySchema } from "./day";
import { eventSchema } from "./event";
import { crewSchema, guestsSchema, seatingSchema, stationerySchema } from "./slices";

export const TROUSSEAU_KIND = "trousseau";
export const TROUSSEAU_VERSION = 1;

/**
 * The slices an app may publish. `sources` is deliberately absent: it is not
 * owned by any app, is written only by the launcher on export, and never lives
 * in the ambient store.
 */
export const SLICE_NAMES = [
  "event",
  "guests",
  "seating",
  "day",
  "crew",
  "stationery",
] as const;

export type SliceName = (typeof SLICE_NAMES)[number];

/**
 * The whole wedding.
 *
 * `looseObject` at every level, without exception. In zod 4 a plain
 * `z.object()` silently strips keys it does not know, which for this document
 * means deleting a slice belonging to an app that has not been written yet.
 * That is the single worst thing this package could do.
 */
export const trousseauSchema = z.looseObject({
  kind: z.literal(TROUSSEAU_KIND).default(TROUSSEAU_KIND),
  version: z.number().default(TROUSSEAU_VERSION),
  event: eventSchema.default(() => eventSchema.parse({})),
  guests: guestsSchema,
  seating: seatingSchema,
  /** Null until Cadence has published a day. */
  day: daySchema.nullable().default(null),
  crew: crewSchema,
  stationery: stationerySchema,
  /** Native documents, keyed by app name. Present only in an exported file. */
  sources: z.record(z.string(), z.unknown()).default(() => ({})),
});

export type Trousseau = z.infer<typeof trousseauSchema>;

/** A new, empty wedding. A fresh object every call. */
export function emptyTrousseau(): Trousseau {
  return trousseauSchema.parse({});
}

/**
 * Validate an unknown document and bring it to the current version.
 *
 * There is only version 1, so this is validation plus defaults today. The seam
 * exists from the first release so that adding version 2 is a change to one
 * function rather than a coordinated release across four repositories.
 *
 * Throws rather than returning a result: a caller that cannot read the document
 * must not proceed to write over it. Callers that want to tolerate failure use
 * `trousseauSchema.safeParse` and leave the stored bytes alone.
 */
export function migrate(doc: unknown): Trousseau {
  return trousseauSchema.parse(doc);
}

/**
 * Set one slice on a raw stored document, copying every other key untouched.
 *
 * Takes and returns *raw* data, not a parsed `Trousseau`, and that is the whole
 * point. Parsing produces only what the schemas describe; if a schema is ever
 * wrong — a plain `z.object()` slipped in, a slice not yet added here — writing
 * the parsed result back would delete real user data. Merging into the raw
 * object means a schema bug can at worst refuse a read. It can never destroy a
 * write.
 *
 * Shallow by design: slices are owned whole, so there is nothing to merge
 * within one.
 */
export function mergeSlice(
  raw: unknown,
  slice: SliceName,
  value: unknown,
): Record<string, unknown> {
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    ...base,
    kind: TROUSSEAU_KIND,
    version: typeof base["version"] === "number" ? base["version"] : TROUSSEAU_VERSION,
    [slice]: value,
  };
}
