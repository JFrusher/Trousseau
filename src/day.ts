import { z } from "zod";

/** The `kind` marker Cadence writes, so a reader can refuse the wrong file politely. */
export const DAY_KIND = "cadence.day";
/** The export format's version. Not the project file's schema version. */
export const DAY_VERSION = 1;

/**
 * A block with its clock times already worked out.
 *
 * `id`, `label`, `lane`, `startMin` and `endMin` are required because
 * `Brigade/src/core/import/day.ts` refuses a block without them. Everything
 * else defaults, because Brigade fills those in rather than refusing — and this
 * schema must never reject a file Brigade accepts today.
 */
export const dayBlockSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  lane: z.string(),
  startMin: z.number(),
  endMin: z.number(),
  location: z.string().default(""),
  notes: z.string().default(""),
  tags: z.array(z.string()).default(() => []),
  contentEndMin: z.number().optional(),
  anchored: z.boolean().default(false),
  moment: z.boolean().default(false),
}).transform((block) => ({
  ...block,
  // Brigade's rule: an absent content end means the block has no buffer.
  contentEndMin: block.contentEndMin ?? block.startMin,
}));

/**
 * A supplier tag with whatever detail was recorded against it.
 *
 * `arrivalMin` is present in Cadence's export and absent from Brigade's reader.
 * It defaults to null so that both round-trip, and so consumers get
 * `number | null` rather than an optional property — the apps compile with
 * `exactOptionalPropertyTypes`, where an optional field is materially harder to
 * assign to.
 */
export const dayTeamSchema = z.looseObject({
  tag: z.string(),
  displayName: z.string().default(""),
  phone: z.string().default(""),
  arrivalMin: z.number().nullable().default(null),
  notes: z.string().default(""),
});

/**
 * The day, resolved.
 *
 * A `.cadence.json` holds anchors, gaps and squeeze floors; knowing when
 * anything actually happens means running Cadence's resolver. Rather than have
 * a second application reimplement that function, Cadence hands out the answer,
 * and this is the shape of the answer.
 *
 * `version` is not constrained to `DAY_VERSION`. A newer file is read as far as
 * this version understands it rather than refused — the same posture Brigade
 * already takes, and the reason its importer carries a `fromFuture` flag rather
 * than an error.
 */
export const daySchema = z.looseObject({
  kind: z.literal(DAY_KIND),
  version: z.number(),
  appVersion: z.string().default(""),
  day: z.looseObject({
    date: z.string(),
    coupleNames: z.string(),
    venueName: z.string(),
    curfewMin: z.number(),
    utcOffsetMin: z.number(),
  }),
  lanes: z.array(z.string()).default(() => []),
  blocks: z.array(dayBlockSchema),
  teams: z.array(dayTeamSchema).default(() => []),
});

export type DayBlock = z.infer<typeof dayBlockSchema>;
export type DayTeam = z.infer<typeof dayTeamSchema>;
export type Day = z.infer<typeof daySchema>;

/** True when the file was written by a Cadence newer than this package. */
export function isFromFuture(day: Day): boolean {
  return day.version > DAY_VERSION;
}
