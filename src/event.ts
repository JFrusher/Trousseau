import { z } from "zod";

/**
 * The facts every app needs and none uniquely owns: who, where, when.
 *
 * Owned by the launcher. Cadence carries the same fields inside its own
 * document and echoes them into `day.day.*`; that echo is a copy, and this is
 * authoritative.
 *
 * Every field has a default because an event is half-filled for most of its
 * life. A missing venue is a normal state, not a validation failure — refusing
 * to parse would mean an app could not read the couple's names until someone
 * had chosen a venue.
 */
export const eventSchema = z.looseObject({
  date: z.string().default(""),
  coupleNames: z.string().default(""),
  venueName: z.string().default(""),
  /** Minutes from the day's 00:00, as everywhere in Cadence. */
  curfewMin: z.number().nullable().default(null),
  utcOffsetMin: z.number().nullable().default(null),
});

export type Event = z.infer<typeof eventSchema>;
